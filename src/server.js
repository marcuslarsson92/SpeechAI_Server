import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import speech from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import fs from 'fs';
import { Readable } from 'stream';
import cors from 'cors';
import { franc } from 'franc';

const app = express();
const multerC = multer();
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS});
const port = 3001;

app.use(setCorsHeaders);
app.use(express.json());

function setCorsHeaders(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
}

app.post('/api/prompt', async (req, res) => {
  try {
        const prompt = req.body.prompt;
        const chatResponse = await openai.chat.completions.create({
          messages: [{ role: 'system', content: prompt}],
          model: 'chatgpt-4o-latest',
          max_tokens: 100,
        });
        const replyText = chatResponse.choices[0].message.content;
        console.log(replyText);
        res.json({ response: replyText });
      } catch (error) {
        console.error('Error handling request; ', error);
        res.status(500).json({ error: 'An error occurred. Please try again. '});
      }

  });


app.post('/api/process-audio', multerC.single('audio'), async (req, res) => {
  let tempAudioPath = 'temp_audio.mp3';

  try {
    fs.writeFileSync(tempAudioPath, req.file.buffer);
    const audioBytes = fs.readFileSync(tempAudioPath).toString('base64');

    // Skicka till Google Speech-to-Text
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'MP3',
        sampleRateHertz: 48000,
        languageCode: 'sv-SE',
        alternativeLanguageCodes: ['en-US', 'es-ES', 'de-DE', 'fr-FR'],
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
      max_tokens: 50,
    });

    const replyText = chatResponse.choices[0].message.content;
    console.log('GPT-4 Svar:', replyText);

    let replyLanguageCode = 'sv-SE';
    const detectedLang = franc(replyText, { minLength: 3 });
    if (detectedLang === 'eng') {
      replyLanguageCode = 'en-US';
    } else if (detectedLang === 'spa') {
      replyLanguageCode = 'es-ES';
    } else if (detectedLang === 'deu') {
      replyLanguageCode = 'de-DE';
    } else if (detectedLang === 'fra') {
      replyLanguageCode = 'fr-FR';
    } else if (detectedLang === 'swe') {
      replyLanguageCode = 'sv-SE';
    } else {
      console.warn('Language not recognized. Using default language code.');
      replyLanguageCode = 'sv-SE';
    }

    // Konvertera svaret till tal med Google Text-to-Speech
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: {
        languageCode: replyLanguageCode,
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
  }
});

app.listen(port, () => {
  console.log('Servern körs på port '+ port);
});
