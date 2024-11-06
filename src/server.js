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
<<<<<<< Updated upstream
=======
import cors from 'cors';
>>>>>>> Stashed changes

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer();
<<<<<<< Updated upstream
const openai = new OpenAI();
=======
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
>>>>>>> Stashed changes
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const port = 3000;

<<<<<<< Updated upstream
=======
//TODO: Se över nedan så inte tillåter något vi inte ska tillåta
function setCorsHeaders(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
}

app.use(setCorsHeaders);


>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
        .on('error', (err) => {
          console.error('Fel vid konvertering:', err);
          reject(err);
        })
=======
        .on('error', reject)
>>>>>>> Stashed changes
        .run();
    });

    // Läs in konverterad ljudfil
    const audioBytes = fs.readFileSync(convertedAudioPath).toString('base64');

    // Skicka till Google Speech-to-Text
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'LINEAR16',
<<<<<<< Updated upstream
        sampleRateHertz: 48000, // Kontrollera att detta är korrekt för din ljudfil
        languageCode: 'sv-SE',
=======
        sampleRateHertz: 48000, 
        languageCode: 'sv-SE', 
>>>>>>> Stashed changes
      },
    });

    const transcription = speechResponse.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Transkription:', transcription);

    // Skicka transkriptionen till OpenAI
    const chatResponse = await openai.chat.completions.create({
<<<<<<< Updated upstream
=======

>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
    // Returnera transkription och ljudsvar som JSON
    res.json({
      transcription,
      responseTranscription: replyText,
      audio: ttsResponse.audioContent.toString('base64'), // Skicka ljudet som base64
    });
  } catch (error) {
    console.error('Fel vid bearbetning:', error.message);
    res.status(500).send('Serverfel: ' + error.message); // Ge mer info tillbaka
  } finally {
    // Rensa upp temporära filer
=======
    res.set('Content-Type', 'audio/mp3');
    res.send(ttsResponse.audioContent);
  } catch (error) {
    console.error('Fel vid bearbetning:', error);
    res.status(500).send('Serverfel');
  } finally {
>>>>>>> Stashed changes
    if (fs.existsSync(tempAudioPath)) {
      fs.unlinkSync(tempAudioPath);
    }
    if (fs.existsSync(convertedAudioPath)) {
      fs.unlinkSync(convertedAudioPath);
    }
  }
});

app.listen(port, () => {
<<<<<<< Updated upstream
  console.log('Servern körs på port ' + port);
=======
  console.log('Servern körs på port '+ port);
>>>>>>> Stashed changes
});
