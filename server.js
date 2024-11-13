import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import speech from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import cors from 'cors';

import Database from './database.js'; 

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS if needed

const upload = multer();
const openai = new OpenAI();
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const database = new Database();

// --------------------- Audio Processing Endpoint --------------------- //

// POST endpoint to handle incoming audio processing and conversation logic
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  const userId = req.body.userId;

  try {
    // Process the audio with Google Speech-to-Text
    const audioBytes = req.file.buffer.toString('base64');
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: { encoding: 'MP3', sampleRateHertz: 48000, languageCode: 'sv-SE' },
    });
    const transcription = speechResponse.results.map(result => result.alternatives[0].transcript).join('\n');
    console.log('Transcription:', transcription);

    // If the prompt is "End conversation", end the current conversation
    if (transcription.trim().toLowerCase() === 'end conversation') {
      await database.endConversation(userId);
      res.status(200).send({ message: 'Conversation ended successfully.' });
      return;
    }

    // Process prompt with OpenAI
    const chatResponse = await openai.chat.completions.create({
      messages: [{ role: 'user', content: transcription }],
      model: 'gpt-4',
    });

    const replyText = chatResponse.choices[0].message.content;
    console.log('OpenAI Response:', replyText);

    // Convert OpenAI response to audio
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: { languageCode: 'sv-SE', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    });
    const answerAudioBuffer = ttsResponse.audioContent;

    // Save conversation with both text and audio
    await database.saveConversation(userId, transcription, replyText, req.file.buffer, answerAudioBuffer);

    // Send audio response to client
    res.set('Content-Type', 'audio/mp3');
    res.send(answerAudioBuffer);
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).send('Server error');
  }
});

// --------------------- User Handling Endpoints --------------------- //

// POST endpoint to register a new user
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await database.registerUser(email, password);
    res.status(200).send(result);
  } catch (error) {
    console.error('Error saving user data:', error);
    if (error.message.includes('Email and password are required.') || error.message.includes('Invalid email format.')) {
      res.status(400).send(error.message);
    } else if (error.message.includes('Email is already in use.') || error.message.includes('Password is already in use.')) {
      res.status(409).send(error.message);
    } else {
      res.status(500).send('Internal server error.');
    }
  }
});

// POST endpoint for user login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userData = await database.loginUser(email, password);
    res.status(200).send(userData);
  } catch (error) {
    console.error('Error logging in user:', error);
    if (error.message.includes('Email and password are required.')) {
      res.status(400).send({ message: error.message });
    } else if (error.message.includes('Invalid email or password.')) {
      res.status(401).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// DELETE endpoint to delete a user by ID
app.delete('/delete-user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await database.deleteUser(userId);
    res.status(200).send(result);
  } catch (error) {
    console.error('Error deleting user:', error);
    if (error.message.includes('not found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// PUT endpoint to update a user's email, password, or admin status
app.put('/update-user/:id', async (req, res) => {
  const userId = req.params.id;
  const { email, password, admin } = req.body;

  if (!email && !password && admin === undefined) {
    return res.status(400).send({ message: 'At least one field (email, password, admin) must be provided for update.' });
  }

  try {
    let updates = {};
    if (email) updates.Email = email;
    if (password) updates.Password = password;
    if (admin !== undefined) updates.Admin = admin;

    await database.updateUser(userId, updates);
    res.status(200).send({ message: `User with ID ${userId} updated successfully.` });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// GET endpoint to fetch user data by ID
app.get('/get-user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const userData = await database.getUserById(userId);
    res.status(200).send(userData);
  } catch (error) {
    console.error('Error fetching user data:', error);
    if (error.message.includes('not found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// GET endpoint to fetch all users in the database *** Uppdatera
app.get('/get-all-users', async (req, res) => {
  try {
    const usersList = await database.getAllUsers();
    res.status(200).send(usersList);
  } catch (error) {
    console.error('Error fetching users:', error);
    if (error.message.includes('No users found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// PUT endpoint to toggle admin status
app.put('/toggle-admin-status', async (req, res) => {
  const { requestingUserId, targetUserId } = req.body;

  try {
    const result = await database.toggleAdminStatus(requestingUserId, targetUserId);
    res.status(200).send(result);
  } catch (error) {
    console.error('Error toggling admin status:', error);
    if (error.message.includes('Permission denied')) {
      res.status(403).send({ message: error.message });
    } else if (error.message.includes('Target user not found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// --------------------- Conversation Handling Endpoints --------------------- //

// GET endpoint to fetch all conversations for a specific user *** Update for guest
app.get('/get-user-conversations/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    const conversationsList = await database.getUserConversations(userId);
    res.status(200).send(conversationsList);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    if (error.message.includes('No conversations found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// GET endpoint to fetch all conversations for all users *** Update for guest
app.get('/get-all-conversations', async (req, res) => {
  try {
    const allConversationsList = await database.getAllConversations();
    res.status(200).send(allConversationsList);
  } catch (error) {
    console.error('Error fetching all conversations:', error);
    if (error.message.includes('No conversations found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// POST endpoint to fetch conversations by userId and date range
app.post('/get-conversations', async (req, res) => {
  const { userId, startDate, endDate } = req.body;

  try {
    const result = await database.getConversationsByDateRange(userId, startDate, endDate);
    res.status(200).send(result);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    if (error.message.includes('No conversations found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});

// --------------------- Audio Handling Endpoints --------------------- //

// GET endpoint to retrieve audio files
app.get('/get-audio-files', async (req, res) => {
  const { userId, conversationId } = req.query;

  try {
    const audioFiles = await database.getAudioFiles({ userId, conversationId });
    res.status(200).json(audioFiles);
  } catch (error) {
    console.error('Error retrieving audio files:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// --------------------- Start the Server --------------------- //

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
