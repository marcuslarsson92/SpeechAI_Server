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
import admin from 'firebase-admin'; // Changed from require to import

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
const ref = db.ref('Transcriptions');  // Create a reference to the "transcriptions" node


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

    // Extrahera GPT-4-svaret (endast textinnehållet)
    const replyText = chatResponse.choices[0].message.content;
    console.log('GPT-4 Svar:', replyText);

    //Spara transkiptionen till Databasen
    const dbRef = admin.database().ref('Transcriptions');
    const newTranscriptionRef = dbRef.push();  // Create a new node for each transcription
    await newTranscriptionRef.set({
    transcription : transcription,
    gpt4Response : replyText,
    timestamp : new DataTransfer().toISOString,
    }).then(() => {
    console.log('Data successfully written to Firebase!');
    }).catch((error) => {
    console.error('Error writing data to Firebase:', error);
    });

    // Konvertera svaret till tal med Google Text-to-Speech
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },  // Skicka endast texten här
      voice: {
        languageCode: 'sv-SE',
        ssmlGender: 'NEUTRAL',
      },
      audioConfig: { audioEncoding: 'MP3' },
    });

    // Skicka tillbaka ljudet som svar
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
