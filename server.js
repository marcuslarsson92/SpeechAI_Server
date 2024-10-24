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
import cors from 'cors';
import admin from 'firebase-admin';


ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer();
const openai = new OpenAI();
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const serviceAccount = JSON.parse(fs.readFileSync('/Users/simonflenman/Kurser/keys/speachai-b5ce2-firebase-adminsdk-odts8-8809efb41f.json', 'utf8'));

// Initialize Firebase Admin with service account credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://speachai-b5ce2-default-rtdb.europe-west1.firebasedatabase.app'  // Realtime Database URL
});

// Get a reference to the Realtime Database
const db = admin.database();

function generateId() {
  return db.ref().push().key; // Generates a unique ID by Firebase
}

// POST endpoint to store new user
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Check if both email and password are provided
  if (!email || !password) {
    return res.status(400).send('Email and password are required.');
  }

  try {
    // Generate a new ID
    const userId = generateId();

    // Create the user object to store
    const newUser = {
      ID: userId,
      Email: email,
      Password: password,
      Admin: false 
    };

    // Save the user data Database
    await db.ref(`users/${userId}`).set(newUser);

    // Send success or error response
    res.status(200).send({ message: 'User registered successfully', userId });
  } catch (error) {
    console.error('Error saving user data:', error);
    res.status(500).send('Internal server error.');
  }
});

// DELETE endpoint to delete a user by ID
app.delete('/delete-user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    // Reference to the user by their ID
    const userRef = db.ref(`users/${userId}`);

    // Check if the user exists
    const snapshot = await userRef.once('value');
    if (snapshot.exists()) {
      // Delete the user from the database
      await userRef.remove();
      res.status(200).send({ message: `User with ID ${userId} deleted successfully.` });
    } else {
      res.status(404).send({ message: `User with ID ${userId} not found.` });
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// PUT endpoint to update email or password
app.put('/update-user/:id', async (req, res) => {
  const userId = req.params.id;  // Get the user ID from the client
  const { email, password, admin } = req.body;  // Get the new email and/or password and/or admin update from the request body

  // Ensure that either email or password is provided for update
  if (!email && !password && admin == undefined) {
    return res.status(400).send({ message: 'At least one field (email, password, admin) must be provided for update.' });
  }

  try {
    // Reference to the user in the Database by their ID
    const userRef = db.ref(`users/${userId}`);

    // Prepare the update object function (only add fields that are provided)
    let updates = {};
    if (email) updates.Email = email;
    if (password) updates.Password = password;
    if (admin !== undefined) updates.Admin = admin; // Only update admin if explicitly provided

    // Update the user's email and/or password
    await userRef.update(updates);

    res.status(200).send({ message: `User with ID ${userId} updated successfully.` });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// GET endpoint to fetch user data by ID
app.get('/get-user/:id', async (req, res) => {
  const userId = req.params.id;  // Get the user ID from the clinet

  try {
    // Reference to the user in Firebase Realtime Database
    const userRef = db.ref(`users/${userId}`);

    // Fetch the user data from the database
    const snapshot = await userRef.once('value');

    // Check if the user exists
    if (snapshot.exists()) {
      const userData = snapshot.val();

      // Extract only the Email and Password
      const { Email, Password, Admin } = userData;

      // Send the email and password back to the client
      res.status(200).send({ Email, Password, Admin });
    } else {
      res.status(404).send({ message: `User with ID ${userId} not found.` });
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// GET endpoint to fetch all users in the databse and return them as an array of strings
app.get('/get-all-users', async (req, res) => {
  try {
    // Reference to the users node in Database
    const usersRef = db.ref('users');

    // Fetch all user data from the databse
    const snapshot = await usersRef.once('value');

    // Check if there are users in the database
    if (snapshot.exists()) {
      const usersData = snapshot.val();

      // Extract only the emails and admin status from each user
      const usersList = Object.values(usersData).map(user => ({
        Email: user.Email,
        Admin: user.Admin
      }));

      // Send the list of emails back to the client
      res.status(200).send(usersList);
    } else {
      res.status(404).send({ message: 'No users found in the database.' });
    }
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// Function to save conversation in Firebase
async function saveConversation(userId, prompt, answer, promptAudioURL = '', answerAudioURL = '') {
  if (!userId) {
      userId = 'Guest';
  }

  // Reference to the user's conversations
  const conversationsRef = db.ref(`Conversations/${userId}`);

  // Check if the last conversation is ongoing (not ended)
  const ongoingConversationSnapshot = await conversationsRef.orderByChild('Ended').equalTo(false).limitToLast(1).once('value');
  let conversationId;
  let conversationData;

  // If an ongoing conversation exists
  if (ongoingConversationSnapshot.exists()) {
      const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
      conversationData = ongoingConversationSnapshot.val()[conversationKey];
      conversationId = conversationKey;

      // Add the new prompt and answer to the existing conversation
      conversationData.PromptsAndAnswers.push({ Prompt: prompt, Answer: answer, PromptAudioURL: promptAudioURL, AnswerAudioURL: answerAudioURL });
      
      // Save the updated conversation
      await db.ref(`Conversations/${userId}/${conversationId}`).update(conversationData);
  } else {
      // No ongoing conversation, create a new one
      conversationId = generateId();
      conversationData = {
          PromptsAndAnswers: [{ Prompt: prompt, Answer: answer, PromptAudioURL: promptAudioURL, AnswerAudioURL: answerAudioURL }],
          Date: new Date().toISOString(),
          Ended: false  // New conversation, not ended
      };

      // Save the new conversation
      await db.ref(`Conversations/${userId}/${conversationId}`).set(conversationData);
  }

  return conversationId; // Return conversation ID for reference if needed
}

// Function to end the conversation
async function endConversation(userId) {
  if (!userId) {
      userId = 'Guest';
  }

  const conversationsRef = db.ref(`Conversations/${userId}`);

  // Find the ongoing conversation and mark it as ended
  const ongoingConversationSnapshot = await conversationsRef.orderByChild('Ended').equalTo(false).limitToLast(1).once('value');
  if (ongoingConversationSnapshot.exists()) {
      const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
      await db.ref(`Conversations/${userId}/${conversationKey}`).update({ Ended: true, EndedAt: new Date().toISOString() });
      console.log(`Conversation ${conversationKey} for user ${userId} ended.`);
  }
}

// GET endpoint to fetch all conversations for a specific user by userId (or "Guest")
app.get('/get-user-conversations/:userId', async (req, res) => {
  const userId = req.params.userId || 'Guest'; // Default to "Guest" if no userId is provided

  try {
    const conversationsRef = db.ref(`Conversations/${userId}`);
    
    // Fetch all conversations for the user
    const snapshot = await conversationsRef.once('value');
    
    if (snapshot.exists()) {
      const conversationsData = snapshot.val();

      // Convert the conversations object to an array of conversations
      const conversationsList = Object.entries(conversationsData).map(([conversationId, conversation]) => ({
        PromptsAndAnswers: conversation.PromptsAndAnswers, // Return all prompt-answer pairs
        Date: conversation.Date  // Return the conversation's date
      }));

      // Send the list of conversations back to the client
      res.status(200).send(conversationsList);
    } else {
      res.status(404).send({ message: 'No conversations found for this user.' });
    }
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});


// GET endpoint to fetch all conversations for all users
app.get('/get-all-conversations', async (req, res) => {
  try {
    const conversationsRef = db.ref('Conversations');

    // Fetch all users and their conversations
    const snapshot = await conversationsRef.once('value');

    if (snapshot.exists()) {
      const allConversationsData = snapshot.val();
      
      // List to hold all users and their conversations
      let allConversationsList = [];

      // Loop through each user (including "Guest" if they exist)
      Object.entries(allConversationsData).forEach(([userId, userConversations]) => {
        let userConvoList = {
          UserId: userId,   
          Conversations: [] // List to hold all conversations for this user
        };

        // Loop through each conversation for this user
        Object.entries(userConversations).forEach(([conversationId, conversation]) => {
          userConvoList.Conversations.push({
            ConversationId: conversationId, 
            PromptsAndAnswers: conversation.PromptsAndAnswers,    
            Date: conversation.Date         
          });
        });

        // Add this user's conversations to the main list
        allConversationsList.push(userConvoList);
      });

      // Send the list of all users and their conversations back to the client
      res.status(200).send(allConversationsList);
    } else {
      res.status(404).send({ message: 'No conversations found in the database.' });
    }
  } catch (error) {
    console.error('Error fetching all conversations:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});


// POST endpoint to fetch conversations by userId (optional) and a date interval
app.post('/get-conversations', async (req, res) => {
  const { userId, startDate, endDate } = req.body; 

  const start = new Date(startDate);
  const end = new Date(endDate);

  try {
    // If userId is provided, fetch only conversations for that user (or "Guest")
    const conversationsRef = userId
      ? db.ref(`Conversations/${userId}`)
      : db.ref('Conversations'); // Fetch all conversations if no userId

    const snapshot = await conversationsRef.once('value');

    if (snapshot.exists()) {
      const allConversationsData = snapshot.val();

      let result = [];

      // Loop through all users (or a single user if userId is provided)
      Object.entries(allConversationsData).forEach(([currentUserId, userConversations]) => {
        let userConvoList = {
          UserId: currentUserId,
          Conversations: []
        };

        // Loop through the conversations for the current user
        Object.entries(userConversations).forEach(([conversationId, conversation]) => {
          const conversationDate = new Date(conversation.Date);

          // Check if the conversation's date is within the specified range
          if (conversationDate >= start && conversationDate <= end) {
            userConvoList.Conversations.push({
              ConversationId: conversationId,
              PromptsAndAnswers: conversation.PromptsAndAnswers,
              Date: conversation.Date
            });
          }
        });

        // Add this user's conversations to the result if they have any matching the date range
        if (userConvoList.Conversations.length > 0) {
          result.push(userConvoList);
        }
      });

      // Send the filtered list of conversations back to the client
      res.status(200).send(result);
    } else {
      res.status(404).send({ message: 'No conversations found.' });
    }
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send({ message: 'Internal server error.' });
  }
});

// POST endpoint to handle incoming audio processing and conversation logic
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  let tempAudioPath = 'temp_audio.webm';
  let convertedAudioPath = 'converted_audio.wav';
  const userId = req.body.userId;

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

      // Process the audio with Google Speech-to-Text
      const audioBytes = fs.readFileSync(convertedAudioPath).toString('base64');
      const [speechResponse] = await speechClient.recognize({
          audio: { content: audioBytes },
          config: { encoding: 'LINEAR16', sampleRateHertz: 48000, languageCode: 'sv-SE' }
      });
      const transcription = speechResponse.results.map(result => result.alternatives[0].transcript).join('\n');

      console.log('Transcription:', transcription);

      // If the prompt is "End conversation", end the current conversation
      if (transcription.trim().toLowerCase() === 'end conversation') {
          await endConversation(userId);
          res.status(200).send({ message: 'Conversation ended successfully.' });
          return;
      }

      // Otherwise, process the prompt with OpenAI and save the conversation
      const chatResponse = await openai.chat.completions.create({
          messages: [{ role: 'system', content: transcription }],
          model: 'gpt-4'
      });

      const replyText = chatResponse.choices[0].message.content;
      console.log('OpenAI Response:', replyText);

      // Save the conversation (ongoing or new)
      await saveConversation(userId, transcription, replyText);

      // Convert the OpenAI response to audio using Google Text-to-Speech
      const [ttsResponse] = await ttsClient.synthesizeSpeech({
          input: { text: replyText },
          voice: { languageCode: 'sv-SE', ssmlGender: 'NEUTRAL' },
          audioConfig: { audioEncoding: 'mp3' }
      });

      res.set('Content-Type', 'audio/mp3');
      res.send(ttsResponse.audioContent);
  } catch (error) {
      console.error('Error processing audio:', error);
      res.status(500).send('Server error');
  } finally {
      if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      if (fs.existsSync(convertedAudioPath)) fs.unlinkSync(convertedAudioPath);
  }
});

app.listen(3000, () => {
  console.log('Servern körs på port 3000');
});
