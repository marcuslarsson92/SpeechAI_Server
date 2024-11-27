// database.js

import fs from 'fs';
import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';

// Initialize Firebase Admin with service account credentials
<<<<<<< Updated upstream
const serviceAccount = JSON.parse(fs.readFileSync('//Users/hasansafiah/Desktop/Keys/speachai-b5ce2-firebase-adminsdk-odts8-8809efb41f.json', 'utf8'));
=======
const serviceAccount = JSON.parse(fs.readFileSync('/Users/hasansafiah/Desktop/Keys/speachai-b5ce2-firebase-adminsdk-odts8-8809efb41f.json', 'utf8'));
>>>>>>> Stashed changes

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
  }

  // Generate a guest ID in the format "Guest-1", "Guest-2", etc.
  async generateGuestId() {
    const usersRef = this.db.ref('users');
    const snapshot = await usersRef.once('value');

    let guestCount = 0;
    if (snapshot.exists()) {
      const users = snapshot.val();
      Object.values(users).forEach(user => {
        if (user.ID && user.ID.startsWith('Guest-')) {
          const num = parseInt(user.ID.split('-')[1], 10);
          if (!isNaN(num) && num > guestCount) {
            guestCount = num;
          }
        }
      });
    }

    return `Guest-${guestCount + 1}`;
  }

  // Generate a unique ID
  generateId() {
    return this.db.ref().push().key;
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
    const userId = await this.generateGuestId();

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
    if (!userId) userId = await this.generateGuestId();

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
    if (!userId) userId = await this.generateGuestId();

    const conversationsRef = this.db.ref(`Conversations/${userId}`);

    // Find the ongoing conversation and mark it as ended
    const ongoingConversationSnapshot = await conversationsRef
      .orderByChild('Ended')
      .equalTo(false)
      .limitToLast(1)
      .once('value');

    if (ongoingConversationSnapshot.exists()) {
      const conversationKey = Object.keys(ongoingConversationSnapshot.val())[0];
      await this.db.ref(`Conversations/${userId}/${conversationKey}`).update({ Ended: true });
      return { message: `Conversation with ID ${conversationKey} ended successfully.` };
    } else {
      throw new Error('No ongoing conversation found for the user.');
    }
  }

  // Format date as a string
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Get all conversations for a user
  async getAllConversations(userId) {
    const conversationsRef = this.db.ref(`Conversations/${userId}`);
    const snapshot = await conversationsRef.once('value');
    if (snapshot.exists()) {
      return snapshot.val();
    } else {
      throw new Error(`No conversations found for user with ID ${userId}.`);
    }
  }

  // Get a specific conversation
  async getConversation(userId, conversationId) {
    const conversationRef = this.db.ref(`Conversations/${userId}/${conversationId}`);
    const snapshot = await conversationRef.once('value');
    if (snapshot.exists()) {
      return snapshot.val();
    } else {
      throw new Error(`Conversation with ID ${conversationId} not found for user ${userId}.`);
    }
  }
}

export default Database;
