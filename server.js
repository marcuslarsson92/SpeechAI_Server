import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { SpeechClient } from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import openai from 'openai';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer();

const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();

const openaiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(openaiConfig);

app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  try {
    // Spara och konvertera ljudfilen
    const tempAudioPath = 'temp_audio.webm';
    const convertedAudioPath = 'converted_audio.wav';
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
        languageCode: 'sv-SE', // Anpassa språk
      },
    });

    const transcription = speechResponse.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Transkription:', transcription);

    // Skicka transkriptionen till OpenAI
    const chatResponse = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [{ role: 'user', content: transcription }],
    });

    const replyText = chatResponse.data.choices[0].message.content;
    console.log('GPT-4 Svar:', replyText);

    // Konvertera svaret till tal med Google Text-to-Speech
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: {
        languageCode: 'es-ES', // Anpassa språk
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
    fs.unlinkSync(tempAudioPath);
    fs.unlinkSync(convertedAudioPath);
  }
});

app.listen(3000, () => {
  console.log('Servern körs på port 3000');
});
