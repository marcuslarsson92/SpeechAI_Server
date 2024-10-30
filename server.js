import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import speech from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import fs from 'fs';
import cors from 'cors';
import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';

const app = express();
const upload = multer();
const openai = new OpenAI();
const ttsClient = new TextToSpeechClient();
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const storage = new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
const bucket = storage.bucket('speachai-b5ce2.appspot.com');

const serviceAccount = JSON.parse(fs.readFileSync('/Users/simonflenman/Kurser/keys/speachai-b5ce2-firebase-adminsdk-odts8-8809efb41f.json', 'utf8'));

// Initialize Firebase Admin with service account credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://speachai-b5ce2-default-rtdb.europe-west1.firebasedatabase.app'
});


// Get a reference to the Realtime Database
const db = admin.database();

function generateId() {
  return db.ref().push().key;
}

// Helper function to upload audio to Firebase Storage
async function uploadAudio(fileBuffer, fileName) {
  const file = bucket.file(fileName);
  await file.save(fileBuffer, { contentType: 'audio/mpeg' });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
}

////////////// User Handeling ///////////////////////////

// POST endpoint to store new user
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Check if both email and password are provided
  if (!email || !password) {
    return res.status(400).send('Email and password are required.');
  }

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  return res.status(400).send('Invalid email format.');
}

  try {
    // Reference to the users node
    const usersRef = db.ref('users');

    // Check if the email or password already exists
    const snapshot = await usersRef.orderByChild('Email').equalTo(email).once('value');
    if (snapshot.exists()) {
      return res.status(409).send('Email is already in use.');
    }
    const passwordSnapshot = await usersRef.orderByChild('Password').equalTo(password).once('value');
    if (passwordSnapshot.exists()) {
      return res.status(409).send('Password is already in use. Please choose a different password.');
    }

    // Generate a new ID
    const userId = generateId();

    // Create the user object to store
    const newUser = {
      ID: userId,
      Email: email,
      Password: password,
      Admin: false
    };

    // Save the user data to the Database
    await db.ref(`users/${userId}`).set(newUser);

    // Send success response
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

// Function to toggle admin status for a specified user
async function toggleAdminStatus(requestingUserId, targetUserId) {
  try {
    // Get the requesting user's admin status
    const requestingUserRef = db.ref(`users/${requestingUserId}`);
    const requestingUserSnapshot = await requestingUserRef.once('value');

    // Check if the requesting user exists and is an admin
    if (!requestingUserSnapshot.exists() || !requestingUserSnapshot.val().Admin) {
      throw new Error('Permission denied: Only admins can toggle admin status.');
    }

    // Get the target user's current admin status
    const targetUserRef = db.ref(`users/${targetUserId}`);
    const targetUserSnapshot = await targetUserRef.once('value');

    // Check if the target user exists
    if (!targetUserSnapshot.exists()) {
      throw new Error('Target user not found.');
    }

    // Toggle the target user's admin status
    const currentAdminStatus = targetUserSnapshot.val().Admin;
    await targetUserRef.update({ Admin: !currentAdminStatus });

    console.log(`Admin status for user ${targetUserId} toggled to ${!currentAdminStatus}`);
    return { message: `Admin status toggled successfully for user ${targetUserId}.`, newAdminStatus: !currentAdminStatus };
  } catch (error) {
    console.error('Error toggling admin status:', error);
    throw error;
  }
}

// Endpoint to toggle admin status
app.put('/toggle-admin-status', async (req, res) => {
  const { requestingUserId, targetUserId } = req.body;

  try {
    // Call the toggleAdminStatus function with provided user IDs
    const result = await toggleAdminStatus(requestingUserId, targetUserId);
    res.status(200).send(result);
  } catch (error) {
    res.status(403).send({ message: error.message });
  }
});

//////////////// Conversation handeling //////////////////////////////


async function saveConversation(userId, prompt, answer, promptAudioBuffer, answerAudioBuffer) {
  if (!userId) userId = 'Guest';

  // Reference to the user's conversations
  const conversationsRef = db.ref(`Conversations/${userId}`);

  // Check for an ongoing conversation
  const ongoingConversationSnapshot = await conversationsRef.orderByChild('Ended').equalTo(false).limitToLast(1).once('value');
  let conversationId;
  let conversationData;

  // Upload audio files and get URLs
  const promptAudioURL = await uploadAudio(promptAudioBuffer, `${userId}/conversations/${generateId()}/prompt.mp3`);
  const answerAudioURL = await uploadAudio(answerAudioBuffer, `${userId}/conversations/${generateId()}/answer.mp3`);

  if (ongoingConversationSnapshot.exists()) {
      const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
      conversationData = ongoingConversationSnapshot.val()[conversationKey];
      conversationId = conversationKey;

      // Add the new prompt and answer to the existing conversation
      conversationData.PromptsAndAnswers.push({
          Prompt: prompt,
          Answer: answer,
          PromptAudioURL: promptAudioURL,
          AnswerAudioURL: answerAudioURL
      });

      // Save the updated conversation
      await db.ref(`Conversations/${userId}/${conversationId}`).update(conversationData);
  } else {
      // No ongoing conversation, create a new one
      conversationId = generateId();
      conversationData = {
          PromptsAndAnswers: [
              {
                  Prompt: prompt,
                  Answer: answer,
                  PromptAudioURL: promptAudioURL,
                  AnswerAudioURL: answerAudioURL
              }
          ],
          Date: new Date().toISOString(),
          Ended: false
      };

      // Save the new conversation
      await db.ref(`Conversations/${userId}/${conversationId}`).set(conversationData);
  }

  return conversationId;
}

// Function to end the conversation
async function endConversation(userId) {
  if (!userId) userId = 'Guest';

  const conversationsRef = db.ref(`Conversations/${userId}`);

  // Find the ongoing conversation and mark it as ended
  const ongoingConversationSnapshot = await conversationsRef.orderByChild('Ended').equalTo(false).limitToLast(1).once('value');
  if (ongoingConversationSnapshot.exists()) {
      const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
      await db.ref(`Conversations/${userId}/${conversationKey}`).update({ Ended: true, EndedAt: new Date().toISOString() });
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
        ConversationId: conversationId,
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

////////////////// Audio Handeling ////////////////////////

// Function to retrieve audio files based on constraints
async function getAudioFiles({ userId = null, conversationId = null }) {
  const result = [];

  try {
    let queryRef;

    // Case 1: No constraints, retrieve all audio files
    if (!userId && !conversationId) {
      queryRef = db.ref('Conversations');
    }
    // Case 2: Only userId provided, retrieve all audio files for that user
    else if (userId && !conversationId) {
      queryRef = db.ref(`Conversations/${userId}`);
    }
    // Case 3: Both userId and conversationId provided, retrieve specific conversation's audio files
    else if (userId && conversationId) {
      queryRef = db.ref(`Conversations/${userId}/${conversationId}`);
    }

    // Fetch data from the database
    const snapshot = await queryRef.once('value');
    if (snapshot.exists()) {
      const data = snapshot.val();

      if (!userId && !conversationId) {
        // No constraints, iterate over all users and their conversations
        for (const [userId, userConversations] of Object.entries(data)) {
          for (const [conversationId, conversation] of Object.entries(userConversations)) {
            conversation.PromptsAndAnswers.forEach(pa => {
              result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
            });
          }
        }
      } else if (userId && !conversationId) {
        // Only userId provided, iterate over all conversations for this user
        for (const [conversationId, conversation] of Object.entries(data)) {
          conversation.PromptsAndAnswers.forEach(pa => {
            result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
          });
        }
      } else if (userId && conversationId) {
        // Both userId and conversationId provided, fetch audio files for the specific conversation
        data.PromptsAndAnswers.forEach(pa => {
          result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
        });
      }
    }

    return result;
  } catch (error) {
    console.error('Error retrieving audio files:', error);
    throw new Error('Failed to retrieve audio files.');
  }
}

// GET endpoint to retrieve audio files
app.get('/get-audio-files', async (req, res) => {
  const { userId, conversationId } = req.query;  // Get userId and conversationId from query parameters

  try {
    const audioFiles = await getAudioFiles({ userId, conversationId });
    res.status(200).json(audioFiles);
  } catch (error) {
    res.status(500).send({ message: 'Internal server error.' });
  }
});


///// POST endpoint to handle incoming audio processing and conversation logic /////
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  const userId = req.body.userId;

  try {
      // Process the audio with Google Speech-to-Text
      const audioBytes = req.file.buffer.toString('base64');
      const [speechResponse] = await speechClient.recognize({
          audio: { content: audioBytes },
          config: { encoding: 'MP3', sampleRateHertz: 48000, languageCode: 'sv-SE' }
      });
      const transcription = speechResponse.results.map(result => result.alternatives[0].transcript).join('\n');
      console.log('Transcription:', transcription);

      // If the prompt is "End conversation", end the current conversation
      if (transcription.trim().toLowerCase() === 'end conversation') {
          await endConversation(userId);
          res.status(200).send({ message: 'Conversation ended successfully.' });
          return;
      }

      // Process prompt with OpenAI
      const chatResponse = await openai.chat.completions.create({
          messages: [{ role: 'system', content: transcription }],
          model: 'gpt-4'
      });

      const replyText = chatResponse.choices[0].message.content;
      console.log('OpenAI Response:', replyText);

      // Convert OpenAI response to audio
      const [ttsResponse] = await ttsClient.synthesizeSpeech({
          input: { text: replyText },
          voice: { languageCode: 'sv-SE', ssmlGender: 'NEUTRAL' },
          audioConfig: { audioEncoding: 'MP3' }
      });
      const answerAudioBuffer = ttsResponse.audioContent;

      // Save conversation with both text and audio
      await saveConversation(userId, transcription, replyText, req.file.buffer, answerAudioBuffer);

      // Send audio response to client
      res.set('Content-Type', 'audio/mp3');
      res.send(answerAudioBuffer);
  } catch (error) {
      console.error('Error processing audio:', error);
      res.status(500).send('Server error');
  }
});

app.listen(3000, () => {
  console.log('Servern körs på port 3000');
});