// database.js
import 'dotenv/config';
import fs from 'fs';
import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';

// Initialize Firebase Admin with service account credentials
const serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_KEY, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://speachai-b5ce2-default-rtdb.europe-west1.firebasedatabase.app'
});

// Get a reference to the Realtime Database and Storage
const db = admin.database();
const storage = new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
const bucket = storage.bucket('speachai-b5ce2.appspot.com');

class Database {
  constructor() {
    this.db = db;
    this.bucket = bucket;
    this.currentGuestId = null;
  }
  generateId() {
    return this.db.ref().push().key;
  }
  
  async generateGuestId() {
    if (this.currentGuestId) {
      return this.currentGuestId;
    }
    const usersRef = this.db.ref('Conversations');
    const snapshot = await usersRef.once('value');
    
    // Find the highest existing Guest ID
    let highestGuestId = 0;
    snapshot.forEach((childSnapshot) => {
      const userId = childSnapshot.key;
      const match = userId.match(/^Guest-(\d+)$/);
      if (match) {
        const idNum = parseInt(match[1], 10);
        if (idNum > highestGuestId) {
          highestGuestId = idNum;
        }
      }
    });
  
    // Increment and return the new Guest ID
    this.currentGuestId = `Guest-${highestGuestId + 1}`;
    return this.currentGuestId;
  }

  // Upload audio to Firebase Storage
  async uploadAudio(fileBuffer, fileName) {
    const file = this.bucket.file(fileName);
    await file.save(fileBuffer, { contentType: 'audio/mpeg' });
    await file.makePublic();
    return `https://storage.googleapis.com/${this.bucket.name}/${file.name}`;
  }

  // --------------------- User-Related Methods --------------------- //

  // Register a new user
  async registerUser(email, password) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !password) {
      throw new Error('Email and password are required.');
    }
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format.');
    }

    const usersRef = this.db.ref('users');

    // Check if the email already exists
    const emailSnapshot = await usersRef.orderByChild('Email').equalTo(email).once('value');
    if (emailSnapshot.exists()) {
      throw new Error('Email is already in use.');
    }

    // Check if the password already exists (note: generally not recommended)
    const passwordSnapshot = await usersRef.orderByChild('Password').equalTo(password).once('value');
    if (passwordSnapshot.exists()) {
      throw new Error('Password is already in use. Please choose a different password.');
    }

    // Generate a new user ID
    const userId = this.generateId();

    const newUser = {
      ID: userId,
      Email: email,
      Password: password,
      Admin: false,
    };

    await this.db.ref(`users/${userId}`).set(newUser);
    return { message: 'User registered successfully', userId };
  }
    // Login a user
    async loginUser(email, password) {
        if (!email || !password) {
          throw new Error('Email and password are required.');
        }
    
        const usersRef = this.db.ref('users');
    
        // Check if the email exists
        const emailSnapshot = await usersRef.orderByChild('Email').equalTo(email).once('value');
        if (!emailSnapshot.exists()) {
          throw new Error('Invalid email or password.');
        }
    
        // Get the user data
        let userId;
        let userData;
        emailSnapshot.forEach((snapshot) => {
          userId = snapshot.key;
          userData = snapshot.val();
        });
    
        // Check if the password matches
        if (userData.Password !== password) {
          throw new Error('Invalid email or password.');
        }
    
        // Return user data (excluding password)
        return { userId: userId, Email: userData.Email, Admin: userData.Admin };
      }

  // Delete a user by ID
  async deleteUser(userId) {
    const userRef = this.db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    if (snapshot.exists()) {
      await userRef.remove();
      return { message: `User with ID ${userId} deleted successfully.` };
    } else {
      throw new Error(`User with ID ${userId} not found.`);
    }
  }

  // Update a user's email, password, or admin status
  async updateUser(userId, updates) {
    const userRef = this.db.ref(`users/${userId}`);
    await userRef.update(updates);
    return { message: `User with ID ${userId} updated successfully.` };
  }

  // Get user data by ID
  async getUserById(userId) {
    const userRef = this.db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    if (snapshot.exists()) {
      const userData = snapshot.val();
      // Do not return the password in the response for security reasons
      return { Email: userData.Email, Admin: userData.Admin };
    } else {
      throw new Error(`User with ID ${userId} not found.`);
    }
  }

  // Get all users
  async getAllUsers() {
    const usersRef = this.db.ref('users');
    const snapshot = await usersRef.once('value');
    if (snapshot.exists()) {
      const usersData = snapshot.val();
      return Object.values(usersData).map((user) => ({
        Email: user.Email,
        Admin: user.Admin,
      }));
    } else {
      throw new Error('No users found in the database.');
    }
  }

  // Toggle admin status for a user
  async toggleAdminStatus(requestingUserId, targetUserId) {
    const requestingUserRef = this.db.ref(`users/${requestingUserId}`);
    const requestingUserSnapshot = await requestingUserRef.once('value');

    if (!requestingUserSnapshot.exists() || !requestingUserSnapshot.val().Admin) {
      throw new Error('Permission denied: Only admins can toggle admin status.');
    }

    const targetUserRef = this.db.ref(`users/${targetUserId}`);
    const targetUserSnapshot = await targetUserRef.once('value');

    if (!targetUserSnapshot.exists()) {
      throw new Error('Target user not found.');
    }

    const currentAdminStatus = targetUserSnapshot.val().Admin;
    await targetUserRef.update({ Admin: !currentAdminStatus });
    return {
      message: `Admin status toggled successfully for user ${targetUserId}.`,
      newAdminStatus: !currentAdminStatus,
    };
  }

  // --------------------- Conversation-Related Methods --------------------- //

  // Save a conversation
  async saveConversation(userId, prompt, answer, promptAudioBuffer, answerAudioBuffer) {
    if (!userId || userId === 'Guest') {
      userId = await this.generateGuestId(); // Generate a new Guest ID if not provided
    }
  
    const conversationsRef = this.db.ref(`Conversations/${userId}`);

    // Check for an ongoing conversation
  const ongoingConversationSnapshot = await conversationsRef
  .orderByChild('Ended')
  .equalTo(false)
  .limitToLast(1)
  .once('value');
  let conversationId;
  let conversationData;

   // Upload audio files and get URLs
  const promptAudioURL = await this.uploadAudio(
    promptAudioBuffer,
    `${userId}/conversations/${this.generateId()}/prompt.mp3`
  );
  const answerAudioURL = await this.uploadAudio(
    answerAudioBuffer,
    `${userId}/conversations/${this.generateId()}/answer.mp3`
  );

  if (ongoingConversationSnapshot.exists()) {
    const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
    conversationData = ongoingConversationSnapshot.val()[conversationKey];
    conversationId = conversationKey;

    conversationData.PromptsAndAnswers.push({
      Prompt: prompt,
      Answer: answer,
      PromptAudioURL: promptAudioURL,
      AnswerAudioURL: answerAudioURL,
    });

    await this.db.ref(`Conversations/${userId}/${conversationId}`).update(conversationData);
  } else {
    // No ongoing conversation, create a new one
    conversationId = this.generateId();
    conversationData = {
      PromptsAndAnswers: [
        {
          Prompt: prompt,
          Answer: answer,
          PromptAudioURL: promptAudioURL,
          AnswerAudioURL: answerAudioURL,
        },
      ],
      Date: this.formatDate(new Date()),
      Ended: false,
    };

    await this.db.ref(`Conversations/${userId}/${conversationId}`).set(conversationData);
  }

  return conversationId;
  }

  // End a conversation
  async endConversation(userId) {
    if (!userId) userId = 'Guest';

    const conversationsRef = this.db.ref(`Conversations/${userId}`);

    // Find the ongoing conversation and mark it as ended
    const ongoingConversationSnapshot = await conversationsRef
      .orderByChild('Ended')
      .equalTo(false)
      .limitToLast(1)
      .once('value');
    if (ongoingConversationSnapshot.exists()) {
      const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
      await this.db
        .ref(`Conversations/${userId}/${conversationKey}`)
        .update({ Ended: true, EndedAt: this.formatDate(new Date()) });
    }
  }
  async endMultiUserConversation(conversationId) {
    const conversationRef = this.db.ref(`MultiUserConversations/${conversationId}`);
    const snapshot = await conversationRef.once('value');
  
    if (snapshot.exists()) {
      await conversationRef.update({
        Ended: true,
        EndedAt: this.formatDate(new Date()),
      });
    } else {
      throw new Error(`Conversation ${conversationId} not found.`);
    }
  }

  // Get conversations for a specific user
  async getUserConversations(userId) {
    if (!userId) userId = 'Guest';

    const conversationsRef = this.db.ref(`Conversations/${userId}`);
    const snapshot = await conversationsRef.once('value');

    if (snapshot.exists()) {
      const conversationsData = snapshot.val();
      return Object.entries(conversationsData).map(([conversationId, conversation]) => ({
        ConversationId: conversationId,
        PromptsAndAnswers: conversation.PromptsAndAnswers,
        Date: conversation.Date,
        Ended: conversation.Ended || false,
        EndedAt: conversation.EndedAt || null,
      }));
    } else {
      throw new Error('No conversations found for this user.');
    }
  }
  async getMultiUserConversationsForUser(userId) {
    const conversationsRef = this.db.ref('MultiUserConversations');
    const snapshot = await conversationsRef.orderByChild(`Users/${userId}`).equalTo(true).once('value');
  
    if (snapshot.exists()) {
      const conversationsData = snapshot.val();
      return Object.entries(conversationsData).map(([conversationId, conversation]) => ({
        ConversationId: conversationId,
        PromptsAndAnswers: conversation.PromptsAndAnswers,
        Date: conversation.Date,
        Ended: conversation.Ended || false,
        EndedAt: conversation.EndedAt || null,
        Users: Object.keys(conversation.Users),
      }));
    } else {
      return []; // No conversations found for this user
    }
  }
  async getAllMultiUserConversations() {
    const conversationsRef = this.db.ref('MultiUserConversations');
    const snapshot = await conversationsRef.once('value');
  
    if (snapshot.exists()) {
      const allConversationsData = snapshot.val();
      const allConversationsList = [];
  
      Object.entries(allConversationsData).forEach(([conversationId, conversationData]) => {
        allConversationsList.push({
          ConversationId: conversationId,
          PromptsAndAnswers: conversationData.PromptsAndAnswers,
          Date: conversationData.Date,
          Ended: conversationData.Ended || false,
          EndedAt: conversationData.EndedAt || null,
          Users: Object.keys(conversationData.Users),
        });
      });
  
      return allConversationsList;
    } else {
      throw new Error('No multi-user conversations found in the database.');
    }
  }    

  //  Get all conversations for a specific user
  async getAllConversationsForUser(userId) {
    // Get single-user conversations
    const singleUserConversations = await this.getUserConversations(userId);
  
    // Get multi-user conversations
    const multiUserConversations = await this.getMultiUserConversationsForUser(userId);
  
    // Combine the results
    return {
      singleUserConversations,
      multiUserConversations,
    };
  }  

  // Get all conversations for all users, including multi-user conversations
async getAllConversations() {
  const conversationsRef = this.db.ref('Conversations');
  const multiUserConversationsRef = this.db.ref('MultiUserConversations');

  const [conversationsSnapshot, multiUserConversationsSnapshot] = await Promise.all([
    conversationsRef.once('value'),
    multiUserConversationsRef.once('value'),
  ]);

  let allConversationsList = [];

  // Process single-user conversations
  if (conversationsSnapshot.exists()) {
    const allConversationsData = conversationsSnapshot.val();

    Object.entries(allConversationsData).forEach(([userId, userConversations]) => {
      let userConvoList = {
        UserId: userId,
        Conversations: [],
      };

      Object.entries(userConversations).forEach(([conversationId, conversation]) => {
        userConvoList.Conversations.push({
          ConversationId: conversationId,
          PromptsAndAnswers: conversation.PromptsAndAnswers,
          Date: conversation.Date,
          Ended: conversation.Ended || false,
          EndedAt: conversation.EndedAt || null,
        });
      });

      allConversationsList.push(userConvoList);
    });
  }

  // Process multi-user conversations
  if (multiUserConversationsSnapshot.exists()) {
    const multiUserConversationsData = multiUserConversationsSnapshot.val();

    // Since multi-user conversations are not tied to a single user, we'll collect them separately
    Object.entries(multiUserConversationsData).forEach(([conversationId, conversationData]) => {
      allConversationsList.push({
        ConversationId: conversationId,
        PromptsAndAnswers: conversationData.PromptsAndAnswers,
        Date: conversationData.Date,
        Ended: conversationData.Ended || false,
        EndedAt: conversationData.EndedAt || null,
        Users: Object.keys(conversationData.Users),
      });
    });
  }

  if (allConversationsList.length > 0) {
    return allConversationsList;
  } else {
    throw new Error('No conversations found in the database.');
  }
}

  // Get conversations by date range
  async getConversationsByDateRange(userId, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const conversationsRef = userId
      ? this.db.ref(`Conversations/${userId}`)
      : this.db.ref('Conversations');

    const snapshot = await conversationsRef.once('value');

    if (snapshot.exists()) {
      const allConversationsData = snapshot.val();
      let result = [];

      const usersData = userId ? { [userId]: allConversationsData } : allConversationsData;

      Object.entries(usersData).forEach(([currentUserId, userConversations]) => {
        let userConvoList = {
          UserId: currentUserId,
          Conversations: [],
        };

        Object.entries(userConversations).forEach(([conversationId, conversation]) => {
          const conversationDate = new Date(conversation.Date);

          if (conversationDate >= start && conversationDate <= end) {
            userConvoList.Conversations.push({
              ConversationId: conversationId,
              PromptsAndAnswers: conversation.PromptsAndAnswers,
              Date: conversation.Date,
              Ended: conversation.Ended || false,
              EndedAt: conversation.EndedAt || null,
            });
          }
        });

        if (userConvoList.Conversations.length > 0) {
          result.push(userConvoList);
        }
      });

      return result;
    } else {
      throw new Error('No conversations found.');
    }
  }
  async saveMultiUserConversation(userIds, prompt, answer, promptAudioBuffer, answerAudioBuffer, conversationId = null) {
    if (!userIds || userIds.length === 0) throw new Error('At least one user ID must be provided.');
  
    // Generate a conversation ID if not provided
    if (!conversationId) {
      conversationId = this.generateId();
    }
  
    // Upload audio files and get URLs
    const promptAudioURL = await this.uploadAudio(
      promptAudioBuffer,
      `multi_conversations/${conversationId}/${this.generateId()}_prompt.mp3`
    );
    const answerAudioURL = await this.uploadAudio(
      answerAudioBuffer,
      `multi_conversations/${conversationId}/${this.generateId()}_answer.mp3`
    );
  
    // Reference to the conversation
    const conversationRef = this.db.ref(`MultiUserConversations/${conversationId}`);
    const snapshot = await conversationRef.once('value');
  
    if (snapshot.exists()) {
      // Conversation exists, append the new prompt and answer
      const conversationData = snapshot.val();
      conversationData.PromptsAndAnswers.push({
        Prompt: prompt,
        Answer: answer,
        PromptAudioURL: promptAudioURL,
        AnswerAudioURL: answerAudioURL,
      });
      conversationData.Date = this.formatDate(new Date()); // Update date
      await conversationRef.update(conversationData);
    } else {
      // New conversation
      const conversationData = {
        Users: {},
        PromptsAndAnswers: [
          {
            Prompt: prompt,
            Answer: answer,
            PromptAudioURL: promptAudioURL,
            AnswerAudioURL: answerAudioURL,
          },
        ],
        Date: this.formatDate(new Date()),
        Ended: false,
        EndedAt: null,
      };
  
      // Add users
      userIds.forEach((userId) => {
        conversationData.Users[userId] = true;
      });
  
      await conversationRef.set(conversationData);
    }
  
    return conversationId;
  }
  

  // --------------------- Audio-Related Methods --------------------- //

  // Get audio files based on constraints
  async getAudioFiles({ userId = null, conversationId = null }) {
    const result = [];

    let queryRef;

    if (!userId && !conversationId) {
      queryRef = this.db.ref('Conversations');
    } else if (userId && !conversationId) {
      queryRef = this.db.ref(`Conversations/${userId}`);
    } else if (userId && conversationId) {
      queryRef = this.db.ref(`Conversations/${userId}/${conversationId}`);
    } else {
      throw new Error('Invalid parameters for getAudioFiles.');
    }

    const snapshot = await queryRef.once('value');
    if (snapshot.exists()) {
      const data = snapshot.val();

      if (!userId && !conversationId) {
        for (const [userId, userConversations] of Object.entries(data)) {
          for (const [conversationId, conversation] of Object.entries(userConversations)) {
            conversation.PromptsAndAnswers.forEach((pa) => {
              result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
            });
          }
        }
      } else if (userId && !conversationId) {
        for (const [conversationId, conversation] of Object.entries(data)) {
          conversation.PromptsAndAnswers.forEach((pa) => {
            result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
          });
        }
      } else if (userId && conversationId) {
        data.PromptsAndAnswers.forEach((pa) => {
          result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
        });
      }
    }

    return result;
  }
  formatDate(date) {
    const year = date.getUTCFullYear();
    const month = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Months are zero-based
    const day = ('0' + date.getUTCDate()).slice(-2);
    const hours = ('0' + date.getUTCHours()).slice(-2);
    const minutes = ('0' + date.getUTCMinutes()).slice(-2);
    return `${year}-${month}-${day}, ${hours}:${minutes}`;
  }
}

export default Database;
