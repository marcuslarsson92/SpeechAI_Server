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
import Database from './database.js';
import * as promptutil from './promptutil.js';


const app = express();
const multerC = multer();
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); //{apiKey: process.env.OPENAI_API_KEY}
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS});
const database = new Database();

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
     /*
        const chatResponse = await openai.chat.completions.create({
          messages: [{ role: 'system', content: prompt}],               //user, inte system !!!
          model: 'chatgpt-4o-latest',
          max_tokens: 100,
        }); */
        const replyText = await getOpenAIResponse(prompt); //chatResponse.choices[0].message.content;
        console.log(replyText);
        res.json({ response: replyText });
      } catch (error) {
        console.error('Error handling request; ', error);
        res.status(500).json({ error: 'An error occurred. Please try again. '});
      }

  });


app.post('/api/process-audio', multerC.single('audio'), async (req, res) => {
  let tempAudioPath = 'temp_audio.mp3';
  const userIds = req.body.userIds;
  const conversationId = req.body.conversationId;
  const isMultiUser = req.body.isMultiUser;

  try {
    // Send to Google-Speech-To-Text
    const audioBytes = req.file.buffer.toString('base64');
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: 'sv-SE',
        alternativeLanguageCodes: ['en-US', 'es-ES', 'de-DE', 'fr-FR'],
      },
    });

    console.log('speechResponse:', speechResponse);
    const transcription = speechResponse.results.map(result => result.alternatives[0].transcript).join('\n');
    console.log('Transkription:', transcription);

    // Skicka transkriptionen till OpenAI
    /*const chatResponse = await openai.chat.completions.create({
      messages: [{ role: 'system', content: transcription }],   // BYT TILL getOpenAIResponse!!
      model: 'gpt-4o',
      max_tokens: 50,
    });

    const replyText = chatResponse.choices[0].message.content;  // BYT TILL getOpenAIResponse!!
    console.log('GPT-4 Svar:', replyText); */

    const replyText = await promptutil.getOpenAIResponse(transcription); 

    let replyLanguageCode = 'sv-SE';
    const detectedLang = franc(transcription, { minLength: 3 });
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
    console.log("detectedLang: " + detectedLang);
    console.log("replyLanguageCode: " + replyLanguageCode);

    if (transcription.trim().toLowerCase() === 'end conversation') {
      const responseText = 'Conversation ended';
      const [ttsResponse] = await ttsClient.synthesizeSpeech({
        input: { text: responseText },
        voice: { languageCode: replyLanguageCode, ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' },
      });

      const responseAudioBuffer = ttsResponse.audioContent;

      // End the conversation without saving the prompt and response
      if (isMultiUser) {
        await database.endMultiUserConversation(conversationId);
      } else {
        await database.endConversation(userIds[0], conversationId);
      }
    
    res.set('Content-Type', 'audio/mp3');
    res.send(responseAudioBuffer);
    return;
    }
  

    //Process prompt with OpenAI
  /*  const chatResponse = await openai.chat.completions.create({
      messages: [{ role: 'system', content: transcription }],
      model: 'gpt-4o',
      max_tokens: 100,
    });

    const replyText = chatResponse.choices[0].message.content;
    console.log('OpenAI Response: ', replyText);
    */

    const replyText = await getOpenAIResponse(transcription);


    // Convert OpenAI response to audio
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: { languageCode: replyLanguageCode,ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    });

    const answerAudioBuffer = ttsResponse.audioContent;

    if (isMultiUser) {
      const newConversationId = await database.saveMultiUserConversation(
        userIds,
        transcription,
        replyText,
        req.file.buffer,
        answerAudioBuffer,
        conversationId
      );

    } else {
      const newConversationId = await database.saveConversation(
        userIds[0],
        transcription,
        replyText,
        req.file.buffer,
        answerAudioBuffer,
        conversationId
      );
    }

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

// GET endpoint to fetch all users in the database
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
    const { singleUserConversations, multiUserConversations } = await database.getAllConversationsForUser(userId);
    res.status(200).send({ singleUserConversations, multiUserConversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    //res.status(500).send({ message: 'Internal server error.' });
    res.status(error.statusCode || 500).send({ message: error.message });
  }
});


// GET endpoint to fetch all conversations for all users *** Update for guest
app.get('/get-all-conversations', async (req, res) => {
  try {
    const allConversationsList = await fetchAllConversations(); //await database.getAllConversations();
    res.status(200).send(allConversationsList);
  } catch (error) {
    console.error('Error fetching all conversations:', error);
    if (error.message.includes('No conversations found')) {
      res.status(404).send({ message: error.message });
    } else {
      //res.status(500).send({ message: 'Internal server error.' });
      res.status(error.statusCode || 500).send({ message: error.message });
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
      //res.status(500).send({ message: 'Internal server error.' });
      res.status(error.statusCode || 500).send({ message: error.message });
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


// --------------------- Analysis Endpoints --------------------- //

app.get('/api/analysis', async (req, res) => {


  
});



app.get('/api/analysis-by-id/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    const { singleUserConversations, multiUserConversations } = await database.getAllConversationsForUser(userId);   
    res.status(200).send({ singleUserConversations, multiUserConversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
   // res.status(500).send({ message: 'Internal server error.' });
   res.status(error.statusCode || 500).send({ message: error.message });
  }

  
});

// --------------------- Analysis Handling --------------------- //       Flytta till en egen fil/klass?

const fetchAllConversations = async () => {
  try {
    return await database.getAllConversations();

  } catch (error) {
    throw error; //Hanteras av metoden som kallar
}};



const fetchConversationsById = async () => {
  try {
    return await database.getAllConversations();

  } catch (error) {
    throw error; //Hanteras av metoden som kallar
}};


const fetchConversationsByIdAndRange = async () => {
  try {
    return await database.getAllConversations();

  } catch (error) {
    throw error; //Hanteras av metoden som kallar
}};




///

const fetchAllALLConversations = async () => {
  try {
    const allConversationsList = await database.getAllConversations();
    if (!allConversationsList || allConversationsList.length === 0) {
      throw new Error('No conversations found');
    }
    return allConversationsList;
  } catch (error) {
    if (error.message.includes('No conversations found')) {
      error.statusCode = 404;
    } else {
      error.statusCode = 500;
    }
    throw error;
  }
};

const fetchUserConversations = async (userId) => {
  try {
    const { singleUserConversations, multiUserConversations } = await database.getAllConversationsForUser(userId);
    return { singleUserConversations, multiUserConversations };
  } catch (error) {
    error.statusCode = 500;
    throw error;
  }
};

const fetchConversationsByDateRange = async (userId, startDate, endDate) => {
  try {
    const result = await database.getConversationsByDateRange(userId, startDate, endDate);
    if (!result || result.length === 0) {
      throw new Error('No conversations found in the given date range');
    }
    return result;
  } catch (error) {
    if (error.message.includes('No conversations found')) {
      error.statusCode = 404;
    } else {
      error.statusCode = 500;
    }
    throw error;
  }
};




// --------------------- Start server --------------------- //

app.listen(3001, () => {
  console.log('Servern körs på port 3001');
});


