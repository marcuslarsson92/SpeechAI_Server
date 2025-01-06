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
const Port = 3001;
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); 
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

        const replyText = await promptutil.getOpenAIResponseText(prompt); 
        console.log(replyText);
        res.json({ response: replyText });
      } catch (error) {
        console.error('Error handling request; ', error);
        res.status(500).json({ error: 'An error occurred. Please try again. '});
      }

  });

/**
 * POST /api/process-audio
 * 
 * This endpoint processes an audio file and simulates a "speech cafe" scenario where multiple users 
 * can have a conversation. The server listens to the conversation, saves it, and only responds when 
 * explicitly invoked by the phrase "Hi speech AI" (with flexible spacing, casing, and supported languages).
 * 
 * ---------------------------
 * INPUTS:
 * - Multipart/form-data:
 *    - 'audio': The audio file (MP3) containing the recorded conversation snippet or user prompt.
 * - JSON fields (in-form-data, stringified):
 *    - 'participants': A JSON-encoded array of participant identifiers (user IDs or emails).
 *      If no participants are provided, the user is treated as a guest.
 * 
 * EXAMPLE REQUEST BODY:
 *  Form-Data:
 *    - audio: <audio_file.mp3>
 *    - participants: ["UserID1", "UserID2"]
 * 
 * ---------------------------
 * WHAT THE ENDPOINT DOES:
 * 1. Converts the incoming audio into text using Google Speech-to-Text. The primary language is sv-SE, 
 *    but it tries to recognize speech in multiple languages (en-US, es-ES, de-DE, fr-FR, and others).
 * 
 * 2. Detects the language of the transcription using the 'franc' library and sets a suitable reply voice 
 *    language for TTS responses.
 * 
 * 3. Special Cases:
 *    - "end conversation": If the transcription is exactly "end conversation", the conversation 
 *      is ended without saving the prompt or generating a response.
 *    - "Hi speech AI": If the user says "Hi speech AI" (in various spacing, casing, and 
 *      supported languages), we treat everything before "Hi speech AI" as just recorded conversation 
 *      with no answer, and everything after "Hi speech AI" is sent to OpenAI for a response. Both 
 *      segments are appended to the same ongoing conversation record in the database, but only if 
 *      those segments are non-empty.
 *    - Additionally, if the entire snippet or either part of the split prompt is empty, 
 *      that empty prompt is ignored and not saved or sent to OpenAI. In such cases, 
 *      the endpoint returns no answer audio.
 * 
 * 4. If "Hi speech AI" is not found, the server only saves the recorded prompt with no answer. 
 *    It does not call OpenAI and does not return an answer. The system simply "listens". 
 *    If that prompt is empty, it is similarly discarded.
 * 
 * ---------------------------
 * DATABASE INTERACTIONS:
 * - If no participants are provided, a guest ID is generated and used.
 * - If multiple participants are provided, it is treated as a multi-user conversation, and data 
 *   is saved with `saveMultiUserConversation`.
 * - If a single participant (one user ID) is provided, it's a single-user conversation using `saveConversation`.
 * 
 * These functions (saveConversation / saveMultiUserConversation) append 
 * the new prompt and (optionally) answer to an ongoing conversation in the Firebase Realtime Database, 
 * but empty prompts are never saved.
 * 
 * ---------------------------
 * OUTPUTS:
 * - On successful processing:
 *    - If "Hi speech AI" triggered a response, the endpoint returns an audio response (MP3) generated 
 *      by TTS for the OpenAI answer.
 *    - If no "Hi speech AI" was found, it returns an empty audio response (just no answer audio).
 *    - If "end conversation" was said, it returns a TTS message "Conversation ended" and ends the conversation.
 *    - If the prompt (or any segment of it) is empty, no data is saved, and the endpoint returns 
 *      an empty audio buffer.
 * 
 * Content-Type of the response is audio/mp3 or audio/mpeg.
 * 
 * - On error (e.g., server issues, speech recognition errors):
 *    - Returns a 500 status code with 'Server error'.
 * 
 * ---------------------------
 * SUMMARY:
 * This endpoint acts as a central piece of the server, handling audio input, speech-to-text, 
 * database storage, and conditional AI responses. It creates a "speech cafe" environment where 
 * the system listens, stores conversation data, and only responds verbally and via OpenAI when 
 * explicitly triggered by the user uttering a key phrase ("Hi speech AI"). Empty prompts are 
 * discarded so as not to clutter the database or invoke AI calls needlessly.
 */

app.post('/api/process-audio', multerC.single('audio'), async (req, res) => {
  const participants = JSON.parse(req.body.participants || '[]'); // Mixed array of user IDs and emails

  // Determine if it's a multi-user conversation based on the number of participants
  const isMultiUser = participants.length > 1;

  // Process participants to get user IDs
  const allUserIds = await processParticipants(participants);

  try {
    // Convert audio to text (entire snippet)
    const audioBytes = req.file.buffer.toString('base64');
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'MP3',
        sampleRateHertz: 48000,
        languageCode: 'sv-SE', // primary language code
        alternativeLanguageCodes: [
          'en-US', 'es-ES', 'de-DE', 'fr-FR',
          'da-DK', 'no-NO', 'fi-FI', 'ru-RU',
          'pt-PT', 'pt-BR', 'pl-PL', 'hu-HU',
          'cs-CZ', 'el-GR', 'it-IT', 'sr-RS',
          'sk-SK', 'zh-CN', 'nl-NL', 'ro-RO',
          'hr-HR', 'bs-BA', 'sl-SI', 'lt-LT',
          'lv-LV', 'et-EE', 'is-IS', 'sq-AL',
          'tr-TR', 'af-ZA'
        ],
      },
    });

    let transcription = speechResponse.results
      .map((result) => result.alternatives[0].transcript)
      .join('\n')
      .trim();

    console.log('Full Transcription:', transcription);

    // If the transcription is completely empty, do nothing and return an empty buffer
    if (!transcription) {
      console.log('No transcription found. Disregarding empty prompt...');
      res.set('Content-Type', 'audio/mpeg');
      return res.send(Buffer.from([])); // Return silent/empty audio
    }

    // Handle "end conversation" if transcription exactly matches
    if (transcription.toLowerCase() === 'end conversation') {
      const responseText = 'Conversation ended';
      const [ttsResponse] = await ttsClient.synthesizeSpeech({
        input: { text: responseText },
        // Using English as default or any chosen language for the TTS
        voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' },
      });

      const responseAudioBuffer = ttsResponse.audioContent;

      // End conversation in DB
      if (allUserIds.length === 0) {
        const userId = await database.generateGuestId();
        await database.endConversation(userId);
      } else if (isMultiUser) {
        await database.endMultiUserConversation(allUserIds);
      } else {
        const userId = allUserIds[0];
        await database.endConversation(userId);
      }

      res.set('Content-Type', 'audio/mp3');
      return res.send(responseAudioBuffer);
    }

    // Detect "Hi speech AI" phrase with flexible pattern
    const hiSpeechAIPattern = new RegExp(
      String.raw`\b(?:hi|high|hai|h\s*i)\s*(?:speech|speach|spech)?\s*(?:ai|a\s*i|a|i)?\b`,
      'i'
    );
    const match = transcription.match(hiSpeechAIPattern);

    let promptBefore = '';
    let promptAfter = '';
    let shouldCallOpenAI = false;

    if (match) {
      const index = match.index;
      promptBefore = transcription.substring(0, index).trim();
      promptAfter = transcription.substring(index + match[0].length).trim();
      shouldCallOpenAI = promptAfter.length > 0;
    } else {
      // No "Hi speech AI" phrase found -> entire snippet is "promptBefore"
      promptBefore = transcription;
      promptAfter = '';
      shouldCallOpenAI = false;
    }

    // If promptBefore is empty, skip saving it.
    // Otherwise, save it as a conversation entry with no answer.
    const userIdForSingle = allUserIds.length === 0
      ? await database.generateGuestId()
      : (isMultiUser ? null : allUserIds[0]);

    const emptyAnswerBuffer = Buffer.from([]);
    const noAnswerText = '';

    if (promptBefore) {
      // Only save if promptBefore is non-empty
      if (allUserIds.length === 0) {
        // Guest scenario
        await database.saveConversation(
          userIdForSingle,
          promptBefore,
          noAnswerText,
          req.file.buffer, // storing entire audio snippet as prompt audio
          emptyAnswerBuffer
        );
      } else if (isMultiUser) {
        await database.saveMultiUserConversation(
          allUserIds,
          promptBefore,
          noAnswerText,
          req.file.buffer,
          emptyAnswerBuffer
        );
      } else {
        // Single-user
        await database.saveConversation(
          userIdForSingle,
          promptBefore,
          noAnswerText,
          req.file.buffer,
          emptyAnswerBuffer
        );
      }
    } else {
      console.log('promptBefore is empty — skipping database save');
    }

    // If there's no text after "Hi speech AI" or user didn't say "Hi speech AI",
    // we skip the OpenAI call and return an empty buffer.
    if (!shouldCallOpenAI) {
      console.log('No AI call triggered, returning empty audio...');
      res.set('Content-Type', 'audio/mpeg');
      return res.send(emptyAnswerBuffer);
    }

    // If promptAfter is empty, skip saving or responding
    if (!promptAfter) {
      console.log('promptAfter is empty — skipping DB save & OpenAI call...');
      res.set('Content-Type', 'audio/mpeg');
      return res.send(emptyAnswerBuffer);
    }

    // Pass promptAfter to OpenAI
    const fullReplyText = await promptutil.getOpenAIResponseText(promptAfter);

    // ChatGPT-svar -> LanguageCode + message
    const { languageCode: replyLanguageCode, message: replyText } =
      promptutil.parseChatGPTResponse(fullReplyText);

    console.log('OpenAI Response:', replyText);
    console.log('ChatGPT LanguageCode:', replyLanguageCode || '(none provided)');

    // Använd ChatGPTs språkkod, eller fallback till "en-US" om saknas
    const finalLanguageCode = replyLanguageCode || 'en-US';

    // Synthesize TTS in the newly detected (or fallback) language
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: { languageCode: finalLanguageCode, ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    });
    const answerAudioBuffer = ttsResponse.audioContent;

    // Save the promptAfter + answer
    if (allUserIds.length === 0) {
      // Guest user
      await database.saveConversation(
        userIdForSingle,
        promptAfter,
        replyText,
        req.file.buffer,
        answerAudioBuffer
      );
    } else if (isMultiUser) {
      await database.saveMultiUserConversation(
        allUserIds,
        promptAfter,
        replyText,
        req.file.buffer,
        answerAudioBuffer
      );
    } else {
      // Single-user
      await database.saveConversation(
        userIdForSingle,
        promptAfter,
        replyText,
        req.file.buffer,
        answerAudioBuffer
      );
    }

    // Return the TTS answer to the client
    res.set('Content-Type', 'audio/mpeg');
    res.send(answerAudioBuffer);

  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).send('Server error');
  }
});


  // Endpoint to end a conversation
app.post('/api/end-conversation', async (req, res) => {
  try {
    // Extract participants from the request body
    const participants = JSON.parse(req.body.participants || '[]'); // Mixed array of user IDs and emails

    const isMultiUser = participants.length > 1;

    // Process participants to get user IDs
    const allUserIds = await processParticipants(participants);

    // Handle conversation ending logic
    if (allUserIds.length === 0) {
      // No user IDs provided, assume guest user
      const guestId = await database.generateGuestId();
      await database.endConversation(guestId);
    } else if (isMultiUser) {
      // Multi-user conversation
      await database.endMultiUserConversation(allUserIds);
    } else {
      // Single-user conversation
      const userId = allUserIds[0];
      await database.endConversation(userId);
    }

    res.status(200).send('Conversation ended successfully.');
  } catch (error) {
    console.error('Error ending conversation:', error);
    res.status(500).send('Server error');
  }
});

// --------------------- User Handling Endpoints --------------------- //

// POST endpoint to register a new user
app.post('/api/register', async (req, res) => {
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
app.post('/api/login', async (req, res) => {
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
app.delete('/api/delete-user/:id', async (req, res) => {
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
app.put('/api/update-user/:id', async (req, res) => {
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
app.get('/api/get-user/:id', async (req, res) => {
  const userId = req.params.id;

  if (userId === 'guest') {
    return res.status(200).send({ Email: 'Unknown user' });
  }
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

// GET endpoint to fetch user ID by email
app.get('/api/get-user-id', async (req, res) => {
  const { email } = req.query;

  try {
  
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const userId = await database.getUserIdByEmail(email);
    res.status(200).json({ userId });
  } catch (error) {
    console.error('Error fetching user ID:', error);

    if (error.message.includes('not found')) {
      res.status(404).json({ message: error.message });
    } else {
      res.status(500).json({ message: 'Internal server error.' });
    }
  }
});

// GET endpoint to fetch all users in the database
app.get('/api/get-all-users', async (req, res) => {
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

  // Function to process the array of one UserID and multiple emails and returns an array with only the correct UserIds
async function processParticipants(participants) {
  const allUserIds = [];

  for (const participant of participants) {
    if (isValidUserId(participant)) {
      allUserIds.push(participant);
    } else if (isValidEmail(participant)) {
      try {
        const userId = await database.getUserIdByEmail(participant);
        allUserIds.push(userId);
      } catch (error) {
        console.error(`Error finding userId for email ${participant}:`, error);
        // Handle missing users
      }
    } else {
      console.warn(`Invalid participant identifier: ${participant}`);
      // Handle invalid entries
    }
  }

  // Remove duplicate user IDs
  return [...new Set(allUserIds)];
}

// PUT endpoint to toggle admin status by email.
app.put('/api/toggle-admin-status', async (req, res) => {
  const { email } = req.body; // The client sends the user's email

  try {
    const result = await database.toggleAdminStatusByEmail(email);
    res.status(200).send(result);
  } catch (error) {
    console.error('Error toggling admin status:', error);
    if (error.message.includes('not found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(500).send({ message: 'Internal server error.' });
    }
  }
});


// Endpoint to get or generate a guest ID
app.get('/api/get-guest-id', async (req, res) => {
  try {
    const guestId = await database.generateGuestId();
    res.status(200).send({ guestId });
  } catch (error) {
    console.error('Error generating guest ID:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});


// --------------------- Conversation Handling Endpoints --------------------- //

// GET endpoint to fetch all conversations for a specific user
app.get('/api/get-user-conversations/:userId?', async (req, res) => {
  let userId = req.params.userId;
  let analysisData = null;

  try {
    if (!userId) {
      // No userId provided, get conversations for a guest user
      const conversations = await database.getUserConversations();
      res.status(200).send({ conversations });
    } else {
      // userId provided, get all conversations for the user
      const { singleUserConversations, multiUserConversations } = await fetchConversationsById(userId);  
      
      //Process conversations and senf for analysis
      const combinedConversations = combineConversations({ singleUserConversations, multiUserConversations });
      const analysisData = await fetchAndProcessAnalysis(combinedConversations);
            
      res.status(200).send({ singleUserConversations, multiUserConversations, analysisData});
    }
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(error.statusCode || 500).send({ message: error.message });
  }
});

// GET endpoint to fetch all conversations for all users
app.get('/api/get-all-conversations', async (req, res) => {
  try {
    const allConversationsList = await fetchAllConversations(); //await database.getAllConversations();
    const filteredConversationsList = allConversationsList.map(conversation => {
      if (!conversation.UserId) {
        
        conversation.UserId = 'guest'; 
      }
      return conversation;
    });
    res.status(200).send(allConversationsList);
  } catch (error) {
    console.error('Error fetching all conversations:', error);
    if (error.message.includes('No conversations found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(error.statusCode || 500).send({ message: error.message });
    }
  }
});

// POST endpoint to fetch conversations by userId and date range
app.post('/api/get-conversations', async (req, res) => {
  const { userId, startDate, endDate } = req.body;

  try {
    const result = await fetchConversationsByIdAndRange(userId, startDate, endDate);  

    const combinedConversations = combineConversations(result);
    const analysisData = await fetchAndProcessAnalysis(combinedConversations);
    res.status(200).send({result, analysisData});
  } catch (error) {
    console.error('Error fetching conversations:', error);
    if (error.message.includes('No conversations found')) {
      res.status(404).send({ message: error.message });
    } else {
      res.status(error.statusCode || 500).send({ message: error.message });
    }
  }
});

// --------------------- Audio Handling Endpoints --------------------- //

// GET endpoint to retrieve audio files
app.get('/api/get-audio-files', async (req, res) => {
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

//GET for all conversations, for all users, reutrning the analysis made on these conversations 
app.get('/api/analysis', async (req, res) => {
  try {    
    const allConversationsList = await fetchAllConversations(); 
    const combinedConversations = combineConversations(allConversationsList);
  const analysisData = await fetchAndProcessAnalysis(combinedConversations);

res.status(200).send(analysisData);
  } catch (error) {
    console.error('Error performing analysis on conversations:', error);
   res.status(error.statusCode || 500).send({ message: error.message });
  }   
});


//GET for fetching all conversations for a specific user, and getting them analyzed for the history/analysis-page
app.get('/api/analysis-by-id/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const { singleUserConversations, multiUserConversations } = await fetchConversationsById(userId); 
    const combinedConversations = combineConversations({singleUserConversations, multiUserConversations});
    const analysisData = await fetchAndProcessAnalysis(combinedConversations);

    console.log("\nAnalysisData (i analysis-by-id):           " + JSON.stringify(analysisData));
 
     res.status(200).send(analysisData);
  } catch (error) {
    console.error('Error performing analysis on conversations:', error);
   res.status(error.statusCode || 500).send({ message: error.message });
  }  
});


//GET for fetching all conversations for a specific user and range, and getting them analyzed for the history/analysis-page
app.get('/api/analysis-by-id-and-range/:userId', async (req, res) => {
  const userId = req.params.userId;
  const { startDate, endDate } = req.query; // Assumes that the date interval is sent as query-parameters

  try {
    const conversations = await fetchConversationsByIdAndRange(userId, startDate, endDate);
    const combinedConversations = combineConversations(conversations);
    const analysisData = await fetchAndProcessAnalysis(combinedConversations);
 
     res.status(200).send(analysisData);
  } catch (error) {
    console.error('Error performing analysis on conversations:', error);
   res.status(error.statusCode || 500).send({ message: error.message });
  }  
});


// --------------------- Fetching Conversations --------------------- //      

//Function to fetch ALL conversations from the database. Returns a list of all the conversations or the appropriate error status code (404 / 500). Throws the error to the calling function
const fetchAllConversations = async () => {
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

//Function to fetch conversations, by userId, from the database. Returns a list of all the conversations or the appropriate error status code (500). Throws the error to the calling function
const fetchConversationsById = async (userId) => {
  try {
    const { singleUserConversations, multiUserConversations } = await database.getAllConversationsForUser(userId);
    return { singleUserConversations, multiUserConversations };
  } catch (error) {
    error.statusCode = 500;
    throw error;
  }
};

//Function to fetch conversations, by userID and date range, from the databas. Returns a list of all the conversations or the appropriate error status code (404 / 500). Throws the error to the calling function
const fetchConversationsByIdAndRange = async (userId, startDate, endDate) => {
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


// --------------------- Analysis Handling --------------------- //   

// Function to combine conversations into a single string of prompts
const combineConversations = (conversations) => {
  if (Array.isArray(conversations)) {
    // If input is an array (e.g., from fetchConversationsByIdAndRange)
    return conversations.reduce((acc, convo) => {
      if (!Array.isArray(convo.PromptsAndAnswers)) {
        console.warn("Invalid PromptsAndAnswers format in conversation:", convo.ConversationId);
        return acc; // Skip this conversation
      }

      const conversationPrompts = convo.PromptsAndAnswers.reduce((promptAcc, pa) => {
        if (typeof pa.Prompt === 'string') {
          promptAcc += `${pa.Prompt} `;
        }
        return promptAcc;
      }, '');

      return acc + conversationPrompts;
    }, '');
  } else if (typeof conversations === 'object' && !Array.isArray(conversations)) {
    // If input is an object (e.g., from fetchAllConversations or fetchConversationsById)
    const { singleUserConversations = [], multiUserConversations = [] } = conversations;

    return [...singleUserConversations, ...multiUserConversations].reduce((acc, convo) => {
      if (!Array.isArray(convo.PromptsAndAnswers)) {
        console.warn("Invalid PromptsAndAnswers format in conversation:", convo.ConversationId);
        return acc; // Skip this conversation
      }

      const conversationPrompts = convo.PromptsAndAnswers.reduce((promptAcc, pa) => {
        if (typeof pa.Prompt === 'string') {
          promptAcc += `${pa.Prompt} `;
        }
        return promptAcc;
      }, '');

      return acc + conversationPrompts;
    }, '');
  } else {
    console.error('Invalid conversations format. Expected an array or an object.');
    throw new Error('Conversations must be an array or an object.');
  }
};



//Function for 
const fetchAndProcessAnalysis = async (combinedConversations) => {
    //Send for analysis, and get textAnalysis (String) and wordCount (int) back               
    const { textAnalysis, wordCount } = await promptutil.getFullTextAnalysis(combinedConversations);

     //Split textAnalysis in sections
     const sections = textAnalysis
     .replace(/\*/g, '') //Remove all asterisk characters
     .replace(/###/g, '') // Remove all ###
     .split(/(?=\d+\.)/)
     .map((section) => section.trim());     
     
    // console.log("SECTIONS:      " + sections);
     
    // Remove all numbers, headers and repeting text from the beginning of section
  const cleanedSections = sections.map((section) => {
    return section
      .replace(/^\d+\.\s*/, '') // Ta bort siffror följt av punkt och mellanslag
      .trim(); // Ta bort onödiga mellanrum
  });

      // Build the analysis object based on the sections array
      const analysisData = {
        vocabularyRichness: cleanedSections[0] || 'No data available.',
        grammarMistakes: cleanedSections[1] || 'No data available.',
        improvements: cleanedSections[2] || 'No data available.',
        fillerWords: cleanedSections[3] || 'No data available.',
        summary: cleanedSections[4] || 'No data available.',
        wordCount: wordCount || 0,
      };

      //console.log("\nAnalysisData:                 " + JSON.stringify(analysisData));

      return analysisData;
}





// --------------------- Start server --------------------- //

app.listen(Port, () => {
  console.log(`The server is running on port ${Port}`);
});

function isValidUserId(id) {
  return typeof id === 'string' && id.trim() !== '' && !id.includes('@');
}
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
async function getFirstUserId(participants) {
  const allUserIds = await processParticipants(participants);
  if (allUserIds.length > 0) {
    return allUserIds[0];
  } else {
    return await database.generateGuestId();
  }
}



