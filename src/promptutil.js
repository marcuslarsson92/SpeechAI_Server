import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); 
const model = 'chatgpt-4o-latest';

let instructions = `
You are an AI teacher helping people with language learning. 
You will respond in the language that the user prompt is written in, 
using at most 100 words. 
On the *first line* of your response, write:
LanguageCode: <LANG_CODE>

Where <LANG_CODE> is the language code (e.g., en-US, sv-SE) that you think best matches the user prompt. 
Then, on subsequent lines, provide your answer in that language.
`;



    //Function for prompting OpenAI
    export const getOpenAIResponseText = async (prompt) => {
        const messages = [{ role: 'system', content: instructions }, { role: 'user', content: prompt }];

        const chatResponse = await openai.chat.completions.create({
          messages,
          model
        });

        //Reset the instruction-prompt
        resetInstructions();
      
        
        return chatResponse.choices[0].message.content;
      };
      export const parseChatGPTResponse = (fullReplyText) => {
        // Splitta upp i rader
        const lines = fullReplyText.split('\n');
      
        // Default/fallback
        let languageCode = null;
        let message = fullReplyText;
      
        if (lines.length > 0) {
          const firstLine = lines[0].trim();
          if (firstLine.startsWith('LanguageCode:')) {
            languageCode = firstLine.replace('LanguageCode:', '').trim();
            // Resten av raderna är själva svaret
            message = lines.slice(1).join('\n').trim();
          }
        }
      
        return { languageCode, message };
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
        if (typeof transcription !== 'string' || transcription === null || transcription === undefined) {
          throw new Error('Transcription is not a String, as expected.');
        }
        const words = transcription.split(' ');
        return words.length;
      };
      
      //Function for sending a prompt to OpenAI, asking for an analysis of the vocabulary richness
      export const getVocabularyRichnessText = async (transcription) => {
        setInstructions("Analyze the following text and identify unique words, repetitive patterns, and the overall variation in word choice. Suggest improvements in sentence structure and word choice for clarity and precision.");
        return getOpenAIResponse(transcription);
      };

      //Function for sending a prompt to OpenAI, asking for an analysis of grammatical errors and sentence construction
      export const getGrammaticalErrorsText = async (transcription) => {
        setInstructions("Analyze the following text and identify sentences with grammatical mistakes and suggest corrections. Ignore the lack of punctuation, as this is missing because the text comes from a transcription of an audio file.s");
        return getOpenAIResponse(transcription);
      };

      
      //Function for sending a prompt to OpenAI, asking for an analysis of filler words
      export const getFillerWordsText = async (transcription) => {
        setInstructions("Analyze the following text and identify and list filler words or expressions (e.g., 'uh', 'um', 'like', 'you know'), including how often each word occurs.':");
        return getOpenAIResponse(transcription);
      };


      export const resetInstructions = () => {
        instructions = `
You are an AI teacher helping people with language learning. 
You will respond in the language that the user prompt is written in, 
using at most 100 words. 
On the *first line* of your response, write:
LanguageCode: <LANG_CODE>

Where <LANG_CODE> is the language code (e.g., en-US, sv-SE) that you think best matches the user prompt. 
Then, on subsequent lines, provide your answer in that language.
`;
      }

      //Setter for the instructions variable
      export const setInstructions = (newInstructions) => {
        if (typeof newInstructions !== 'string' || newInstructions.trim() === '') {
          throw new Error('Instructions must be a non-empty string.');
        }
        instructions = newInstructions;
      };
      