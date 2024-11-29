import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); //{apiKey: process.env.OPENAI_API_KEY}
const model = 'chatgpt-4o-latest';

const instructions = "Du är en AI-lärare som hjälper människor att lära sig svenska."; //TEST - TA BORT

    //Använda flagga för att styra vilken typ av analys / feedback som ska fixas?   
    //Gör instructions dynamisk - skicka med från frontend


    //Dynamic function for prompting OpenAI - with or without instructions
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
      export const getFullTextAnalysis = async (transcription) => {
        //TODO: Kalla alla andra analys-funktioner

        const wordCount = getWordCountText(transcription);
        //const vocabularyRichness = await getVocabularyRichnessText(transcription);
        //const grammaticalErrors = await getGrammaticalErrorsText(transcription);
        //const fillerWords = await getFillerWordsText(transcription);

        //Nedan ersätter ovan och skickar en enda prompt för alla analyserna
        const instructions = "Analysera följande text för: 1. Ordförrådets rikedom: Identifiera unika ord, repetitiva mönster och den övergripande variationen i ordval. 2.Grammatiska fel: Identifiera meningar med grammatiska misstag och föreslå korrigeringar. 3.Förbättringar: Föreslå förbättringar i meningsstruktur och ordval för tydlighet och precision. 4. Fyllnadsord: Identifiera och lista fyllnadsord eller uttryck (t.ex. 'eh', 'öh', 'typ', 'du vet'), inkludera hur ofta varje ord förekommer. 4. Sammanfattning: Ge en kortfattad sammanfattning av den övergripande analysen.";
        const textAnalysis = await getOpenAIResponseText(instructions, transcription);

        return { textAnalysis, wordCount };
      };

      //Function for getting the word count from the text transcription
      export const getWordCountText = (transcription) => {
        const words = transcription.split(' ');
        return words.length;
      };
      
      //Function for sending a prompt to OpenAI, asking for an analysis of the vocabulary richness
      export const getVocabularyRichnessText = async (transcription) => {
        return getOpenAIResponse('Analysera följande text och identifiera bredden och variationen i ordförrådet:', transcription);
      };

      //Function for sending a prompt to OpenAI, asking for an analysis of grammatical errors and sentence construction
      export const getGrammaticalErrorsText = async (transcription) => {
        return getOpenAIResponse('Analysera följande text och identifiera grammatiska fel och förbättringar', transcription);
      };

      
      //Function for sending a prompt to OpenAI, asking for an analysis of filler words
      export const getFillerWordsText = async (transcription) => {
        return getOpenAIResponse('Analysera följande text och identifiera utfyllnadsord och slaskord som till exempel "eh" "uhm"', transcription);
      };


