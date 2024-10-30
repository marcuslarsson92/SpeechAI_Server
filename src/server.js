import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import speech from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { Readable } from 'stream';
import cors from 'cors';

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer();
const openai = new OpenAI();
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const port = 3001;

//TODO: Se över nedan så inte tillåter något vi inte ska tillåta
function setCorsHeaders(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
}

app.use(setCorsHeaders);

/*
app.use(cors({
  origin: 'http://localhost:5173', // Använd frontend-porten    - 'http://localhost:8080'
  methods: ['GET', 'POST'], // Tillåt bara specifika metoder
})); */

app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  let tempAudioPath = 'temp_audio.webm';
  let convertedAudioPath = 'converted_audio.wav';

  try {
    // Spara och konvertera ljudfilen
    fs.writeFileSync(tempAudioPath, req.file.buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempAudioPath)
        .output(convertedAudioPath)
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .format('wav')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Läs in konverterad ljudfil
    const audioBytes = fs.readFileSync(convertedAudioPath).toString('base64');

    // Skicka till Google Speech-to-Text
    const [speechResponse] = await speechClient.recognize({
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

    console.log('Transkription:', transcription);

    // Skicka transkriptionen till OpenAI
    const chatResponse = await openai.chat.completions.create({

      messages: [{ role: 'system', content: transcription }],
      model: 'gpt-4o',
    });

    const replyText = chatResponse.choices[0].message.content;
    console.log('GPT-4 Svar:', replyText);

    // Konvertera svaret till tal med Google Text-to-Speech
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: {
        languageCode: 'sv-SE',
        ssmlGender: 'NEUTRAL',
      },
      audioConfig: { audioEncoding: 'MP3' },
    });

    res.set('Content-Type', 'audio/mp3');
    res.send(ttsResponse.audioContent);
  } catch (error) {
    console.error('Fel vid bearbetning:', error);
    res.status(500).send('Serverfel');
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      fs.unlinkSync(tempAudioPath);
    }
    if (fs.existsSync(convertedAudioPath)) {
      fs.unlinkSync(convertedAudioPath);
    }
  }
});

app.listen(port, () => {
  console.log('Servern körs på port '+ port);
});
