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

app.post('/api/process-audio', multerC.single('audio'), async (req, res) => {
  
  let tempAudioPath = 'temp_audio.mp3';
  const participants = JSON.parse(req.body.participants || '[]'); // Mixed array of user IDs and emails

  // Determine if it's a multi-user conversation based on the number of participants
  const isMultiUser = participants.length > 1;

  // Process participants to get user IDs
  const allUserIds = await processParticipants(participants);


  try {
    // Send to Google-Speech-To-Text
    const audioBytes = req.file.buffer.toString('base64');
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'MP3',
        sampleRateHertz: 48000,
        languageCode: 'sv-SE',
        alternativeLanguageCodes: ['en-US', 'es-ES', 'de-DE', 'fr-FR'],
      },
    });

    console.log('speechResponse:', speechResponse);
    const transcription = speechResponse.results.map(result => result.alternatives[0].transcript).join('\n');
    console.log('Transcription:', transcription);



    let replyText = await promptutil.getOpenAIResponseText(transcription); 

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

        // Handle 'end conversation' without saving the prompt and response
if (transcription.trim().toLowerCase() === 'end conversation') {
  const responseText = 'Conversation ended';
  const [ttsResponse] = await ttsClient.synthesizeSpeech({
    input: { text: responseText },
    voice: { languageCode: replyLanguageCode, ssmlGender: 'NEUTRAL' },
    audioConfig: { audioEncoding: 'MP3' },
  });
  const responseAudioBuffer = ttsResponse.audioContent;
    
          // End the conversation without saving the prompt and response
          if (allUserIds.length === 0) {
            const userId = await database.generateGuestId();
            await database.endConversation(userId);
          } else if (isMultiUser) {
            // Multi-user conversation
            await database.endMultiUserConversation(allUserIds);
          } else {
            // Single-user conversation
            const userId = allUserIds[0];
            await database.endConversation(userId);
          }
    
          res.set('Content-Type', 'audio/mp3');
          res.send(responseAudioBuffer);
          return; 
        }

    //Process prompt with OpenAI
    replyText = await promptutil.getOpenAIResponseText(transcription, );

    // Convert OpenAI response to audio
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: { languageCode: replyLanguageCode,ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    });

    const answerAudioBuffer = ttsResponse.audioContent;
    console.log('Type of audioContent:', typeof ttsResponse.audioContent);

    console.log('*********************Answer audio buffer:', answerAudioBuffer);

// Handle cases where no user IDs are found (e.g., guest users)
if (allUserIds.length === 0) {
  const userId = await database.generateGuestId();
  await database.saveConversation(
    userId,
    transcription,
    replyText,
    req.file.buffer,
    answerAudioBuffer
  );
} else if (isMultiUser) {
  // Multi-user conversation
  await database.saveMultiUserConversation(
    allUserIds,
    transcription,
    replyText,
    req.file.buffer,
    answerAudioBuffer
  );
} else {
  // Single-user conversation
  const userId = allUserIds[0];
  await database.saveConversation(
    userId,
    transcription,
    replyText,
    req.file.buffer,
    answerAudioBuffer
  );
}

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

// GET endpoint to fetch all conversations for a specific user ******************************************************************* Update for guest
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
    const allConversationsList = await fetchAllConversations(); 

    const combinedConversations = combineConversations(allConversationsList);
    const analysisData = await fetchAndProcessAnalysis(combinedConversations);

    res.status(200).send({allConversationsList, analysisData});
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



