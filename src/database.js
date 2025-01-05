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
    async loginUser(email, password) { /// Lösen krav
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

  // Get User By Email
  async getUserIdByEmail(email) {
    const usersRef = this.db.ref('users');
    const snapshot = await usersRef.orderByChild('Email').equalTo(email).once('value');
    if (snapshot.exists()) {
      const userData = snapshot.val();
      const userId = Object.keys(userData)[0];
      return userId;
    } else {
      throw new Error(`User with email ${email} not found.`);
    }
  }

  // Toggle admin status for a user by email.
  async toggleAdminStatusByEmail(email) {
    const usersRef = this.db.ref('users');
    const snapshot = await usersRef.orderByChild('Email').equalTo(email).once('value');
  
    if (!snapshot.exists()) {
      throw new Error(`User with email ${email} not found.`);
    }
  
    let targetUserId;
    let targetUserData;
  
    snapshot.forEach((childSnapshot) => {
      targetUserId = childSnapshot.key;
      targetUserData = childSnapshot.val();
    });
  
    const currentAdminStatus = !!targetUserData.Admin;
    const newAdminStatus = !currentAdminStatus;
  
    // Update the admin status in the database
    await this.db.ref(`users/${targetUserId}`).update({ Admin: newAdminStatus });
  
    return {
      message: `Admin status for user ${email} has been set to ${newAdminStatus}.`
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

    if (!Array.isArray(conversationData.PromptsAndAnswers)) {
      conversationData.PromptsAndAnswers = [];
    }
    
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

  // Find the latest ongoing conversation and mark it as ended
  const ongoingConversationSnapshot = await conversationsRef
    .orderByChild('Ended')
    .equalTo(false)
    .limitToLast(1)
    .once('value');

  if (ongoingConversationSnapshot.exists()) {
    const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
    await conversationsRef.child(conversationKey).update({
      Ended: true,
      EndedAt: this.formatDate(new Date()),
    });
  } else {
    console.warn(`No ongoing conversation found for user ${userId} to end.`);
  }
}

  // Ends the MultiUserConversation for the specific users
async endMultiUserConversation(userIds) {
  if (!userIds || userIds.length === 0) {
    console.warn('No user IDs provided to end the conversation.');
    return;
  }

  const conversationsRef = this.db.ref(`MultiUserConversations`);

  // Retrieve all conversations
  const snapshot = await conversationsRef.once('value');

  if (snapshot.exists()) {
    const conversations = snapshot.val();
    let conversationToEnd = null;

    // Iterate through each conversation
    for (const [conversationId, conversationData] of Object.entries(conversations)) {
      const conversationUserIds = Object.keys(conversationData.Users);

      // Check if all users match
      const allUsersMatch =
        conversationUserIds.length === userIds.length &&
        userIds.every((userId) => conversationUserIds.includes(userId));

     
      const isEnded =
        conversationData.Ended === true;

      // Check if the conversation has not ended and all userIds match
      if (allUsersMatch && !isEnded) {
        conversationToEnd = conversationId;
        break;
      }
    }

    if (conversationToEnd) {
      await conversationsRef.child(conversationToEnd).update({
        Ended: true,
        EndedAt: this.formatDate(new Date()),
      });
      console.log(`Conversation ${conversationToEnd} has been ended.`);
    } else {
      console.warn('No matching ongoing conversation found to end.');
    }
  } else {
    console.warn('No multi-user conversations found.');
  }
}

  // Get conversations for a specific user
  async getUserConversations(userId) {
    if (!userId) {
      userId = await this.generateGuestId();
    }
  
    const conversationsRef = this.db.ref(`Conversations/${userId}`);
    const snapshot = await conversationsRef.once('value');
  
    if (!snapshot.exists()) {
      throw new Error('No conversations found for this user.');
    }
  
    const conversationsData = snapshot.val();
  
    return Object.entries(conversationsData).map(([conversationId, conversation]) => {
      // Filter out empty-prompt entries
      let filteredPrompts = [];
      if (Array.isArray(conversation.PromptsAndAnswers)) {
        filteredPrompts = conversation.PromptsAndAnswers.filter((pa) => {
          return pa.Prompt && pa.Prompt.trim() !== '';
        });
      }
  
      return {
        ConversationId: conversationId,
        PromptsAndAnswers: filteredPrompts,
        Date: conversation.Date,
        Ended: conversation.Ended || false,
        EndedAt: conversation.EndedAt || null,
      };
    });
  }  

  // Retrives the MultiUserConversations for the specific user by ID
  async getMultiUserConversationsForUser(userId) {
    const conversationsRef = this.db.ref('MultiUserConversations');
    const snapshot = await conversationsRef
      .orderByChild(`Users/${userId}`)
      .equalTo(true)
      .once('value');
  
    if (!snapshot.exists()) {
      return []; // No conversations found for this user
    }
  
    const conversationsData = snapshot.val();
  
    return Object.entries(conversationsData).map(([conversationId, conversation]) => {
      // Filter out empty-prompt entries
      let filteredPrompts = [];
      if (Array.isArray(conversation.PromptsAndAnswers)) {
        filteredPrompts = conversation.PromptsAndAnswers.filter((pa) => {
          return pa.Prompt && pa.Prompt.trim() !== '';
        });
      }
  
      return {
        ConversationId: conversationId,
        PromptsAndAnswers: filteredPrompts,
        Date: conversation.Date,
        Ended: conversation.Ended || false,
        EndedAt: conversation.EndedAt || null,
        Users: Object.keys(conversation.Users),
      };
    });
  }  

  // Gets all MultiUserConversations from the database
  async getAllMultiUserConversations() {
    const conversationsRef = this.db.ref('MultiUserConversations');
    const snapshot = await conversationsRef.once('value');
  
    if (!snapshot.exists()) {
      throw new Error('No multi-user conversations found in the database.');
    }
  
    const allConversationsData = snapshot.val();
    const allConversationsList = [];
  
    Object.entries(allConversationsData).forEach(([conversationId, conversationData]) => {
      // Filter out empty-prompt entries
      let filteredPrompts = [];
      if (Array.isArray(conversationData.PromptsAndAnswers)) {
        filteredPrompts = conversationData.PromptsAndAnswers.filter((pa) => {
          return pa.Prompt && pa.Prompt.trim() !== '';
        });
      }
  
      allConversationsList.push({
        ConversationId: conversationId,
        PromptsAndAnswers: filteredPrompts,
        Date: conversationData.Date,
        Ended: conversationData.Ended || false,
        EndedAt: conversationData.EndedAt || null,
        Users: Object.keys(conversationData.Users),
      });
    });
  
    return allConversationsList;
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
          // Filter out empty-prompt entries
          let filteredPrompts = [];
          if (Array.isArray(conversation.PromptsAndAnswers)) {
            filteredPrompts = conversation.PromptsAndAnswers.filter((pa) => {
              return pa.Prompt && pa.Prompt.trim() !== '';
            });
          }
  
          userConvoList.Conversations.push({
            ConversationId: conversationId,
            PromptsAndAnswers: filteredPrompts,
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
        // Filter out empty-prompt entries
        let filteredPrompts = [];
        if (Array.isArray(conversationData.PromptsAndAnswers)) {
          filteredPrompts = conversationData.PromptsAndAnswers.filter((pa) => {
            return pa.Prompt && pa.Prompt.trim() !== '';
          });
        }
  
        allConversationsList.push({
          ConversationId: conversationId,
          PromptsAndAnswers: filteredPrompts,
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
  
    // References to both nodes
    const singleUserRef = userId
      ? this.db.ref(`Conversations/${userId}`)
      : this.db.ref('Conversations');
  
    const multiUserRef = this.db.ref('MultiUserConversations');
  
    // Fetch data from both nodes in parallel
    const [singleUserSnapshot, multiUserSnapshot] = await Promise.all([
      singleUserRef.once('value'),
      multiUserRef.once('value'),
    ]);
  
    let result = [];
  
    // Process single-user conversations
    if (singleUserSnapshot.exists()) {
      const allConversationsData = singleUserSnapshot.val();
  
      // If userId is set, we only look at that user’s conversations. If not, we look at all.
      const usersData = userId ? { [userId]: allConversationsData } : allConversationsData;
  
      Object.entries(usersData).forEach(([currentUserId, userConversations]) => {
        Object.entries(userConversations).forEach(([conversationId, conversation]) => {
          const conversationDate = new Date(conversation.Date);
  
          if (conversationDate >= start && conversationDate <= end) {
            // Filter out empty-prompt entries
            let filteredPrompts = [];
            if (Array.isArray(conversation.PromptsAndAnswers)) {
              filteredPrompts = conversation.PromptsAndAnswers.filter((pa) => {
                return pa.Prompt && pa.Prompt.trim() !== '';
              });
            }
  
            result.push({
              ConversationId: conversationId,
              Users: [currentUserId],
              PromptsAndAnswers: filteredPrompts,
              Date: conversation.Date,
              Ended: conversation.Ended || false,
              EndedAt: conversation.EndedAt || null,
            });
          }
        });
      });
    }
  
    // Process multi-user conversations
    if (multiUserSnapshot.exists()) {
      const multiUserData = multiUserSnapshot.val();
  
      Object.entries(multiUserData).forEach(([conversationId, conversation]) => {
        const conversationDate = new Date(conversation.Date);
  
        if (conversationDate >= start && conversationDate <= end) {
          // If userId is provided, check if user is part of the conversation
          if (!userId || (conversation.Users && conversation.Users[userId])) {
            // Filter out empty-prompt entries
            let filteredPrompts = [];
            if (Array.isArray(conversation.PromptsAndAnswers)) {
              filteredPrompts = conversation.PromptsAndAnswers.filter((pa) => {
                return pa.Prompt && pa.Prompt.trim() !== '';
              });
            }
  
            result.push({
              ConversationId: conversationId,
              Users: Object.keys(conversation.Users || {}),
              PromptsAndAnswers: filteredPrompts,
              Date: conversation.Date,
              Ended: conversation.Ended || false,
              EndedAt: conversation.EndedAt || null,
            });
          }
        }
      });
    }
  
    if (result.length > 0) {
      return result;
    } else {
      throw new Error('No conversations found within the specified date range.');
    }
  }  
  

    // Function to save MultiUserConversations
   async saveMultiUserConversation(userIds, prompt, answer, promptAudioBuffer, answerAudioBuffer) {
    if (!userIds || userIds.length === 0) {
      console.warn('No user IDs provided to save the conversation.');
      return;
    }
  
    const conversationsRef = this.db.ref('MultiUserConversations');
  
    // Upload audio files and get URLs
    const promptAudioURL = await this.uploadAudio(
      promptAudioBuffer,
      `multiUserConversations/${this.generateId()}/prompt.mp3`
    );
    const answerAudioURL = await this.uploadAudio(
      answerAudioBuffer,
      `multiUserConversations/${this.generateId()}/answer.mp3`
    );
  
    // Retrieve all conversations
    const snapshot = await conversationsRef.once('value');
  
    let conversationId = null;
    let conversationData = null;
  
    if (snapshot.exists()) {
      const conversations = snapshot.val();
  
      // Iterate through each conversation to find an ongoing one with the exact userIds
      for (const [convId, convData] of Object.entries(conversations)) {
        const conversationUserIds = Object.keys(convData.Users).map(String);
        const normalizedUserIds = userIds.map(String);
  
        const allUsersMatch =
          conversationUserIds.length === normalizedUserIds.length &&
          normalizedUserIds.every((userId) => conversationUserIds.includes(userId));
        const isEnded = convData.Ended === true;
  
        if (allUsersMatch && !isEnded) {
          conversationId = convId;
          conversationData = convData;
          break;
        }
      }
    }
  
    if (conversationId && conversationData) {
      // Append to existing conversation
      if (!conversationData.PromptsAndAnswers) {
        conversationData.PromptsAndAnswers = [];
      }
  
      conversationData.PromptsAndAnswers.push({
        Prompt: prompt,
        Answer: answer,
        PromptAudioURL: promptAudioURL,
        AnswerAudioURL: answerAudioURL,
      });
  
      await conversationsRef.child(conversationId).update(conversationData);
    } else {
      // Create new conversation
      conversationId = this.generateId();
      const usersObject = {};
      userIds.forEach((userId) => {
        usersObject[userId] = true;
      });
  
      conversationData = {
        Users: usersObject,
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
  
      await conversationsRef.child(conversationId).set(conversationData);
    }
  
    return conversationId;
  }

  // --------------------- Audio-Related Methods --------------------- //

  // Get audio files based on constraints
  async getAudioFiles({ userId = null, conversationId = null }) {
    const result = [];
  
    // References to both nodes
    const singleUserRef = this.db.ref('Conversations');
    const multiUserRef = this.db.ref('MultiUserConversations');
  
    // Fetch data from both nodes in parallel
    const [singleUserSnapshot, multiUserSnapshot] = await Promise.all([
      singleUserRef.once('value'),
      multiUserRef.once('value'),
    ]);
  
    // Process single-user conversations
    if (singleUserSnapshot.exists()) {
      const data = singleUserSnapshot.val();
  
      if (!userId && !conversationId) {
        // Retrieve all audio files from all single-user conversations
        for (const [uid, userConversations] of Object.entries(data)) {
          for (const [convId, conversation] of Object.entries(userConversations)) {
            if (conversation.PromptsAndAnswers) {
              conversation.PromptsAndAnswers.forEach((pa) => {
                result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
              });
            }
          }
        }
      } else if (userId && !conversationId) {
        // Retrieve audio files from all conversations of the specified user
        const userConversations = data[userId];
        if (userConversations) {
          for (const [convId, conversation] of Object.entries(userConversations)) {
            if (conversation.PromptsAndAnswers) {
              conversation.PromptsAndAnswers.forEach((pa) => {
                result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
              });
            }
          }
        }
      } else if (conversationId) {
        // Retrieve audio files from the specified conversation ID
        if (userId) {
          // Specific user and conversation ID
          const conversation = data[userId]?.[conversationId];
          if (conversation && conversation.PromptsAndAnswers) {
            conversation.PromptsAndAnswers.forEach((pa) => {
              result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
            });
          }
        } else {
          // Search all users for the conversation ID
          for (const [uid, userConversations] of Object.entries(data)) {
            const conversation = userConversations[conversationId];
            if (conversation && conversation.PromptsAndAnswers) {
              conversation.PromptsAndAnswers.forEach((pa) => {
                result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
              });
              break; // Stop searching after finding the conversation
            }
          }
        }
      }
    }
  
    // Process multi-user conversations
    if (multiUserSnapshot.exists()) {
      const data = multiUserSnapshot.val();
  
      if (!userId && !conversationId) {
        // Retrieve all audio files from all multi-user conversations
        for (const [convId, conversation] of Object.entries(data)) {
          if (conversation.PromptsAndAnswers) {
            conversation.PromptsAndAnswers.forEach((pa) => {
              result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
            });
          }
        }
      } else if (userId && !conversationId) {
        // Retrieve audio files from conversations involving the specified user
        for (const [convId, conversation] of Object.entries(data)) {
          const users = conversation.Users || {};
          if (users[userId] && conversation.PromptsAndAnswers) {
            conversation.PromptsAndAnswers.forEach((pa) => {
              result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
            });
          }
        }
      } else if (conversationId) {
        // Retrieve audio files from the specified conversation ID
        const conversation = data[conversationId];
        if (conversation && conversation.PromptsAndAnswers) {
          conversation.PromptsAndAnswers.forEach((pa) => {
            result.push({ promptAudioURL: pa.PromptAudioURL, answerAudioURL: pa.AnswerAudioURL });
          });
        }
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
