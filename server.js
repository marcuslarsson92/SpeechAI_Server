// Server.js
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import speech from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import Database from './database.js';

ffmpeg.setFfmpegPath(ffmpegPath);

class Server {
  constructor() {
    this.app = express();
    this.upload = multer();
    this.database = new Database();

    this.openai = new OpenAI();
    this.ttsClient = new TextToSpeechClient();
    this.speechClient = new speech.SpeechClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });

    this.sessionUserId = null;
  }

  // Initialize server
  async initialize() {
    this.sessionUserId = await this.database.generateGuestId();
    console.log(`New session user ID: ${this.sessionUserId}`);

    this.setupRoutes();
    this.app.listen(3000, () => {
      console.log('Server is running on port 3000');
    });
  }

  // Setup routes for the server
  setupRoutes() {
    this.app.post('/api/process-audio', this.upload.single('audio'), this.processAudio.bind(this));
  }

  // Process the audio file
  async processAudio(req, res) {
    let tempAudioPath = 'temp_audio.webm';
    let convertedAudioPath = 'converted_audio.wav';

    try {
      // Save and convert audio file
      fs.writeFileSync(tempAudioPath, req.file.buffer);

      await new Promise((resolve, reject) => {
        ffmpeg(tempAudioPath)
          .output(convertedAudioPath)
          .audioCodec('pcm_s16le')
          .format('wav')
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      const audioBytes = fs.readFileSync(convertedAudioPath).toString('base64');

      // Send audio to Google Speech-to-Text
      const [speechResponse] = await this.speechClient.recognize({
        audio: { content: audioBytes },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 48000,
          languageCode: 'sv-SE',
        },
      });

      const transcription = speechResponse.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');
      console.log('Transcription:', transcription);

      // Send transcription to OpenAI
      const chatResponse = await this.openai.chat.completions.create({
        messages: [{ role: 'system', content: transcription }],
        model: 'gpt-4',
      });

      const replyText = chatResponse.choices[0].message.content;
      console.log('GPT-4 Response:', replyText);

      // Save to Firebase
      await this.database.saveTranscription(this.sessionUserId, transcription, replyText);

      // Convert reply to audio with Google Text-to-Speech
      const [ttsResponse] = await this.ttsClient.synthesizeSpeech({
        input: { text: replyText },
        voice: { languageCode: 'sv-SE', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' },
      });

      res.set('Content-Type', 'audio/mp3');
      res.send(ttsResponse.audioContent);

    } catch (error) {
      console.error('Error processing:', error);
      res.status(500).send('Server error');
    } finally {
      if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      if (fs.existsSync(convertedAudioPath)) fs.unlinkSync(convertedAudioPath);
    }
  }
}

// Start the server
const server = new Server();
server.initialize();
