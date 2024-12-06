import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); 
const model = 'chatgpt-4o-latest';

let instructions = "Du är en AI-lärare som hjälper människor vid språkinlärning";  //Sätts via funktion/setter

    //Använda flagga för att styra vilken typ av analys / feedback som ska fixas?   
    //Gör instructions dynamisk - skicka med från frontend


    //Function for prompting OpenAI
    export const getOpenAIResponseText = async (prompt) => {
        const messages = [{ role: 'system', content: instructions }, { role: 'user', content: prompt }];
      
        console.log(messages);             //                   <------------------------------------------------ TEST   -- TA BORT

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

        //Nedan ersätter de individuella anropen och skickar en enda prompt för alla analyserna
        const instructions = "Analysera följande text för: 1. Ordförrådets rikedom: Identifiera unika ord, repetitiva mönster och den övergripande variationen i ordval. 2.Grammatiska fel: Identifiera meningar med grammatiska misstag och föreslå korrigeringar. 3.Förbättringar: Föreslå förbättringar i meningsstruktur och ordval för tydlighet och precision. 4. Fyllnadsord: Identifiera och lista fyllnadsord eller uttryck (t.ex. 'eh', 'öh', 'typ', 'du vet'), inkludera hur ofta varje ord förekommer. 4. Sammanfattning: Ge en kortfattad sammanfattning av den övergripande analysen. Varje del ska börjas med sin titel, i svaret, t.ex 'Sammanfattning'";
        setInstructions(instructions);
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
        setInstructions("Analysera följande text och identifiera bredden och variationen i ordförrådet:");
        return getOpenAIResponse(transcription);
      };

      //Function for sending a prompt to OpenAI, asking for an analysis of grammatical errors and sentence construction
      export const getGrammaticalErrorsText = async (transcription) => {
        setInstructions("Analysera följande text och identifiera grammatiska fel och föreslå korrigeringar:");
        return getOpenAIResponse(transcription);
      };

      
      //Function for sending a prompt to OpenAI, asking for an analysis of filler words
      export const getFillerWordsText = async (transcription) => {
        setInstructions("Analysera följande text och identifiera utfyllnadsord och slaskord som till exempel 'eh' 'uhm':");
        return getOpenAIResponse(transcription);
      };


      export const resetInstructions = () => {
        instructions = "Du är en AI-lärare som hjälper människor med språkinlärning";  
      }

      //Setter for the instructions variable
      export const setInstructions = (newInstructions) => {
        if (typeof newInstructions !== 'string' || newInstructions.trim() === '') {
          throw new Error('Instructions must be a non-empty string.');
        }
        instructions = newInstructions;
      };
      