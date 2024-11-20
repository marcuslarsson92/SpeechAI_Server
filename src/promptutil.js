import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); //{apiKey: process.env.OPENAI_API_KEY}
const model = 'chatgpt-4o-latest';
const maxTokens = 100;


async function giveInstructions(req, res, roleInstruction = 'system') {
    //Role + prompt
    //Gör roleInstruction dynamisk - skicka med från frontend
    try {
        const prompt = req.body.prompt;
        const chatResponse = await openai.chat.completions.create({
          messages: [{ role: roleInstruction, content: prompt}],
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


function wordCount(transcript) {
    let words = transcript.split(' ');
    return words.length;
}



function vocabularyRichness() {

}




function grammaticalErrors() {

}