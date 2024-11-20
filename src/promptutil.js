import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); //{apiKey: process.env.OPENAI_API_KEY}
const model = 'chatgpt-4o-latest';
const maxTokens = 100;

const instructions = "Du är en AI-lärare som hjälper människor att lära sig svenska."; //TEST - TA BORT


    //KOPPLA TRANSKRIBERINGARNA TILL OLIKA ANVÄNDARE PÅ NÅT SÄTT
    //Ändra från 'system' till 'user' efter role, även i server.js
    //instructions + prompt
    //Gör instructions dynamisk - skicka med från frontend
async function giveInstructions(req, res, instructions) {

    try {
        const prompt = req.body.prompt;
        const chatResponse = await openai.chat.completions.create({
          messages: [{role: 'system', content: instructions},  //Instruktioner till hur OpenAI ska bete sig
            { role: 'user', content: prompt}],    //Prompten från användaren/-na
          model: model,
          max_tokens: maxTokens,
        });
        const replyText = chatResponse.choices[0].message.content;
        console.log(replyText);
        res.json({ response: replyText });
      } catch (error) {
        console.error('Error handling request; ', error);
        res.status(500).json({ error: 'An error occurred. Please try again. '});  //Ta bort här?
      }
}


function wordCount(transcription) {
    let words = transcription.split(' ');
    return words.length;
}



function vocabularyRichness(transcription) {
    return `Analysera följande text och identifiera bredden och variationen i ordförrådet: ${transcription}`;
}




function grammaticalErrors(transcription) {
    return `Analysera följande text och identifiera grammatiska fel och förbättringar: ${transcription}`;
}