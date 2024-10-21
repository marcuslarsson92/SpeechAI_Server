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

app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  let tempAudioPath = 'temp_audio.webm';
  let convertedAudioPath = 'converted_audio.wav';

  try {
    // Spara och konvertera ljudfilen
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

    // Läs in konverterad ljudfil
    const audioBytes = fs.readFileSync(convertedAudioPath).toString('base64');

    // Skicka till Google Speech-to-Text
    const [speechResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 44100, 
        languageCode: 'sv-SE', 
      },
    });

    const transcription = speechResponse.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Transkription:', transcription);

    // Skicka transkriptionen till OpenAI
    const chatResponse = await openai.chat.completions.create({

      messages: [{ role: 'system', content: transcription }],
      model: 'gpt-4o',
    });

    const replyText = chatResponse.choices[0];
    console.log('GPT-4 Svar:', replyText);

    // Konvertera svaret till tal med Google Text-to-Speech
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: replyText },
      voice: {
        languageCode: 'sv-SE',
        ssmlGender: 'NEUTRAL',
      },
      audioConfig: { audioEncoding: 'mp3' },
    });

    res.set('Content-Type', 'audio/mp3');
    res.send(ttsResponse.audioContent);
  } catch (error) {
    console.error('Fel vid bearbetning:', error);
    res.status(500).send('Serverfel');
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      fs.unlinkSync(tempAudioPath);
    }
    if (fs.existsSync(convertedAudioPath)) {
      fs.unlinkSync(convertedAudioPath);
    }
  }
});

app.listen(3000, () => {
  console.log('Servern körs på port 3000');
});
