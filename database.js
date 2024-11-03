import fs from 'fs';
import admin from 'firebase-admin';

// Initialize Firebase
const serviceAccount = JSON.parse(fs.readFileSync('/Users/nicke/Keys/apikeysdatabase.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://speechai-ec400-default-rtdb.europe-west1.firebasedatabase.app'
});

const db = admin.database();
const ref = db.ref('Transcriptions');

class Database {
  constructor() {
    this.ref = ref;
  }

  // Generate a unique Guest ID
  async generateGuestId() {
    const snapshot = await this.ref.once('value');
    const users = snapshot.val();
    let maxGuestNumber = 0;

    for (const userId in users) {
      if (userId.startsWith('Guest-')) {
        const guestNumber = parseInt(userId.split('-')[1], 10);
        if (!isNaN(guestNumber) && guestNumber > maxGuestNumber) {
          maxGuestNumber = guestNumber;
        }
      }
    }

    return `Guest-${maxGuestNumber + 1}`;
  }

  // Save a transcription and GPT response to Firebase
  async saveTranscription(sessionUserId, transcription, replyText) {
    const userTranscriptionsRef = this.ref.child(sessionUserId);
    const newTranscriptionRef = userTranscriptionsRef.push();
    
    await newTranscriptionRef.set({
      transcription,
      gpt4response: replyText,
      timestamp: new Date().toISOString(),
    });
    console.log('Data successfully written to Firebase!');
  }
}

export default Database;
