import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); 
const model = 'chatgpt-4o-latest';

let instructions = resetInstructions(); //Set default instructions via function/setter


    //Function for prompting OpenAI
    export const getOpenAIResponseText = async (prompt) => {
        const messages = [{ role: 'system', content: instructions }, { role: 'user', content: prompt }];
      
       // console.log(messages);             //                   <------------------------------------------------ TEST   -- TA BORT

        const chatResponse = await openai.chat.completions.create({
          messages,
          model
        });

        //Reset the instruction-prompt
        resetInstructions();
      
        return chatResponse.choices[0].message.content;
      };

      
      //Function for getting the word count from the text transcription
      export const getFullTextAnalysis = async (transcription) => {

        const wordCount = getWordCountText(transcription);

      //Below replaces individual requests and sends a single prompt for all analyses
    setInstructions("Analyze the following text for: 1. Vocabulary richness: Identify unique words, repetitive patterns, and the overall variation in word choice. "
      + "2. Grammatical errors: Identify sentences with grammatical mistakes and suggest corrections. Ignore the lack of punctuation, as this is missing because the text comes from a transcription of an audio file. "
      + "3. Improvements: Suggest improvements in sentence structure and word choice for clarity and precision. "
      + "4. Filler words: Identify and list filler words or expressions (e.g., 'uh', 'um', 'like', 'you know'), including how often each word occurs. "
      + "5. Summary: Provide a concise summary of the overall analysis. "
      + "Each part of your response should start with the numbers 1-5, as specified here, but without the descriptive titles, e.g., 'Vocabulary richness', 'Grammatical errors', 'Filler words', 'Summary', etc. These titles MUST NOT be included in your responses. "
      + "Refer to the text as a 'conversation' instead of a 'text'. ");
    const textAnalysis = await getOpenAIResponseText(transcription);

        return { textAnalysis, wordCount };
      };

      //Function for getting the word count from the text transcription
      export const getWordCountText = (transcription) => {
        const words = transcription.split(' ');
        return words.length;
      };
      
      //Function for sending a prompt to OpenAI, asking for an analysis of the vocabulary richness
      export const getVocabularyRichnessText = async (transcription) => {
        setInstructions("Analyze the following text and identify the breadth and variation of the vocabulary:");
        return getOpenAIResponse(transcription);
      };

      //Function for sending a prompt to OpenAI, asking for an analysis of grammatical errors and sentence construction
      export const getGrammaticalErrorsText = async (transcription) => {
        setInstructions("Analyze the following text and identify grammatical errors and suggest corrections");
        return getOpenAIResponse(transcription);
      };

      
      //Function for sending a prompt to OpenAI, asking for an analysis of filler words
      export const getFillerWordsText = async (transcription) => {
        setInstructions("Analyze the following text and identify filler words and expressions, such as 'uh', 'um':");
        return getOpenAIResponse(transcription);
      };


      export const resetInstructions = () => {
        instructions = "You are an AI teacher helping people with language learning and will respond in the language I write in from now on. Your response must be a maximum of 100 words.";  
      }

      //Setter for the instructions variable
      export const setInstructions = (newInstructions) => {
        if (typeof newInstructions !== 'string' || newInstructions.trim() === '') {
          throw new Error('Instructions must be a non-empty string.');
        }
        instructions = newInstructions;
      };
      