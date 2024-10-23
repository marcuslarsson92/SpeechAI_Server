import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import textToSpeechLib from '@google-cloud/text-to-speech';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

dotenv.config();

const client = new TextToSpeechClient();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Set up Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Initialize OpenAI API
 const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

// Helper Functions

// Transcribe Audio Using Whisper API
async function transcribeAudio(audioPath) {
  try {
    const response = await openai.createTranscription(
      fs.createReadStream(audioPath),
      'whisper-1'
    );
    return response.data.text;
  } catch (error) {
    console.error('Error in transcribeAudio:', error);
    throw error;
  }
}

// Get Chat Response from ChatGPT
async function getChatResponse(userInput) {
  try {
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: userInput }],
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error in getChatResponse:', error);
    throw error;
  }
}

async function convertTextToSpeech(text) {
  const request = {
    input: { text },
    voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);
  const outputFile = `output_${Date.now()}.mp3`;
  fs.writeFileSync(outputFile, response.audioContent, 'binary');
  return outputFile;
}

// Route Handlers

app.post('/api/voice', upload.single('audio'), async (req, res) => {
  try {
    const audioPath = req.file.path;

    const convertedAudioPath = await convertAudio(audioPath);

    // Step 1: Transcribe Audio
    const transcription = await transcribeAudio(convertedAudioPath);
    console.log('Transcription:', transcription);

    // Step 2: Get ChatGPT Response
    const chatResponse = await getChatResponse(transcription);
    console.log('ChatGPT Response:', chatResponse);

    // Step 3: Convert Response to Speech
    const audioResponse = await convertTextToSpeech(chatResponse);

    // Step 4: Send Audio Response
    res.sendFile(audioResponse, { root: __dirname }, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      // Clean up files
      fs.unlinkSync(audioPath);
      fs.unlinkSync(convertedAudioPath);
      fs.unlinkSync(audioResponse);
    });
  } catch (error) {
    console.error('Error in /api/voice:', error);
    res.status(500).send('Server Error');
  }
});

ffmpeg.setFfmpegPath(ffmpegPath);

// Convert audio to mp3
function convertAudio(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = `${inputPath}.mp3`;
    ffmpeg(inputPath)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

// Start the Server

app.listen(3001, () => {
  console.log('Server is running on port 3001');
});
