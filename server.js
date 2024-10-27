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
import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';  // For generating unique user IDs

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer();
const openai = new OpenAI();
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const serviceAccount = JSON.parse(fs.readFileSync('/Users/nicke/Keys/apikeysdatabase.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://speechai-ec400-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const ref = db.ref('Transcriptions');

// Generate a unique user ID for this session
const sessionUserId = uuidv4();  // This will be used to group all session's transcriptions

app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  let tempAudioPath = 'temp_audio.webm';
  let convertedAudioPath = 'converted_audio.wav';

  try {
    // Save and convert the audio file
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

    // Send transcription to OpenAI
    const chatResponse = await openai.chat.completions.create({
      messages: [{ role: 'system', content: transcription }],
      model: 'gpt-4o',
    });

    const replyText = chatResponse.choices[0].message.content;
    console.log('GPT-4 Svar:', replyText);

    // Save the transcription and GPT-4 response to the database under the session-specific user ID
    const userTranscriptionsRef = ref.child(sessionUserId); // Use the sessionUserId
    const newTranscriptionRef = userTranscriptionsRef.push();  // Create a new node under this user ID
    await newTranscriptionRef.set({
      transcription: transcription,
      gpt4response: replyText,
      timestamp: new Date().toISOString(),
    });

    console.log('Data successfully written to Firebase!');

    // Convert reply to audio with Google Text-to-Speech
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: { languageCode: 'sv-SE', ssmlGender: 'NEUTRAL' },
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

app.listen(3000, () => {
  console.log('Servern körs på port 3000');
});
