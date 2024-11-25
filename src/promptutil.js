import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); //{apiKey: process.env.OPENAI_API_KEY}
const model = 'chatgpt-4o-latest';

const instructions = "Du är en AI-lärare som hjälper människor att lära sig svenska."; //TEST - TA BORT

    //Använda flagga för att styra vilken typ av analys / feedback som ska fixas

    //KOPPLA TRANSKRIBERINGARNA TILL OLIKA ANVÄNDARE PÅ NÅT SÄTT
    //Ändra från 'system' till 'user' efter role, även i server.js
    //instructions + prompt
    //Gör instructions dynamisk - skicka med från frontend


    export const getOpenAIResponse = async (prompt, instructions = '') => {
        const messages = instructions
          ? [{ role: 'system', content: instructions }, { role: 'user', content: prompt }]
          : [{ role: 'user', content: prompt }];
      
        const chatResponse = await openai.chat.completions.create({
          messages,
          model,
          max_tokens: maxTokens,
        });
      
        return chatResponse.choices[0].message.content;
      };


      export const getWordCount = (transcription) => {
        const words = transcription.split(' ');
        return words.length;
      };
      
      export const getVocabularyRichness = (transcription) => {
        return `Analysera följande text och identifiera bredden och variationen i ordförrådet: ${transcription}`;
      };





      


async function promptOpenAI(transcription, instructions) {

        try {
            const prompt = transcription.body.prompt;        

            if (instructions){
                const chatResponse = await openai.chat.completions.create({
                messages: [{role: 'system', content: instructions},  //Instruktioner till hur OpenAI ska bete sig
                    { role: 'user', content: prompt}],    //Prompten från användaren/-na
                model: model
                });
            } else if (!instructions) {
                const chatResponse = await openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt}],    //Prompten från användaren/-na
                model: model
                });
        }

        const replyText = chatResponse.choices[0].message.content;
        console.log(replyText);
        res.json({ response: replyText });   //Vad göra med res? Inte definierad någonstans
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

