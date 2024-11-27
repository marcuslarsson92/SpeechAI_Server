import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); //{apiKey: process.env.OPENAI_API_KEY}
const model = 'chatgpt-4o-latest';

const instructions = "Du är en AI-lärare som hjälper människor att lära sig svenska."; //TEST - TA BORT

    //Använda flagga för att styra vilken typ av analys / feedback som ska fixas?

    //Ändra från 'system' till 'user' efter role, även i server.js
    //instructions + prompt
    //Gör instructions dynamisk - skicka med från frontend


    //Dynamic function for prompting OpenAI - with our without instructions
    export const getOpenAIResponse = async (prompt, instructions) => {
        const messages = instructions
          ? [{ role: 'system', content: instructions }, { role: 'user', content: prompt }]
          : [{ role: 'user', content: prompt }];
      
        const chatResponse = await openai.chat.completions.create({
          messages,
          model,
         // max_tokens: maxTokens,
        });
      
        return chatResponse.choices[0].message.content;
      };



      //Function for getting the word count from the text transcription
      export const getWordCountText = (transcription) => {
        const words = transcription.split(' ');
        return words.length;
      };
      
      //Function for sending a prompt to OpenAI, asking for an analysis of the vocabulary richness
      export const getVocabularyRichnessText = async (transcription) => {
        return getOpenAIResponse(`Analysera följande text och identifiera bredden och variationen i ordförrådet: ${transcription}`);
      };

      //Function for sending a prompt to OpenAI, asking for an analysis of grammatical errors and sentence construction
      export const getGrammaticalErrorsText = async (transcription) => {
        return getOpenAIResponse(`Analysera följande text och identifiera grammatiska fel och förbättringar: ${transcription}`);
      };

      
      //Function for sending a prompt to OpenAI, asking for an analysis of grammatical errors and sentence construction
      export const getFillerWordsText = async (transcription) => {
        return getOpenAIResponse(`Analysera följande text och identifiera grammatiska fel och förbättringar: ${transcription}`);
      };


