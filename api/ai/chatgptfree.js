const axios = require('axios');
const fs = require('fs');

const meta = {
  name: 'ChatGPT Free (Conversational)',
  path: '/chatgpt-free?prompt=&uid=&model=',
  method: 'get',
  category: 'ai'
};

const convoFile = 'convo.json';
const model_list = {
  chatgpt4: {
    api: 'https://stablediffusion.fr/gpt4/predict2',
    referer: 'https://stablediffusion.fr/chatgpt4'
  },
  chatgpt3: {
    api: 'https://stablediffusion.fr/gpt3/predict',
    referer: 'https://stablediffusion.fr/chatgpt3'
  }
};

// Ensure convo file exists
if (!fs.existsSync(convoFile)) {
  fs.writeFileSync(convoFile, JSON.stringify({}), 'utf-8');
}

function loadConversation(uid, model) {
  const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
  const key = `${uid}_${model}`;
  return convos[key] || [];
}

function saveConversation(uid, model, messages) {
  const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
  const key = `${uid}_${model}`;
  convos[key] = messages;
  fs.writeFileSync(convoFile, JSON.stringify(convos, null, 2), 'utf-8');
}

function clearConversation(uid, model) {
  const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
  const key = `${uid}_${model}`;
  delete convos[key];
  fs.writeFileSync(convoFile, JSON.stringify(convos, null, 2), 'utf-8');
}

async function onStart({ req, res }) {
  let prompt, uid, model;
  
  if (req.method === 'POST') {
    ({ prompt, uid, model } = req.body);
  } else {
    ({ prompt, uid, model } = req.query);
  }
  
  model = model || 'chatgpt4';

  if (!prompt || !uid) {
    return res.status(400).json({
      error: 'Both prompt and uid parameters are required',
      example: '/chatgpt-free-convo?prompt=hello&uid=123&model=chatgpt4'
    });
  }

  if (!model_list[model]) {
    return res.status(400).json({
      error: `Invalid model. Available models: ${Object.keys(model_list).join(', ')}`
    });
  }

  try {
    // Handle "clear" command
    if (prompt.toLowerCase() === 'clear') {
      clearConversation(uid, model);
      return res.json({ message: 'Conversation history cleared.' });
    }

    // Load previous conversation
    let conversation = loadConversation(uid, model);

    // Add new user message
    conversation.push({ role: 'user', content: prompt });

    // Get the last user message for API (most APIs expect single prompt, not full history)
    const lastUserMessage = conversation.filter(m => m.role === 'user').pop().content;
    
    // Build context from previous messages (optional - some APIs support it)
    const contextHistory = conversation.slice(0, -1).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const fullPrompt = contextHistory ? `${contextHistory}\nUser: ${lastUserMessage}\nAssistant:` : lastUserMessage;

    // Load referer to receive cookies if any
    const refererResp = await axios.get(model_list[model].referer);
    const setCookie = refererResp.headers && refererResp.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : undefined;

    const { data } = await axios.post(
      model_list[model].api,
      { prompt: fullPrompt },
      {
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          origin: 'https://stablediffusion.fr',
          referer: model_list[model].referer,
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    const answer = data.message || 'No response received.';

    // Save assistant reply
    conversation.push({ role: 'assistant', content: answer });
    saveConversation(uid, model, conversation);

    // Send response
    res.json({
      status: true,
      response: answer
    });

  } catch (error) {
    console.error('ChatGPT Free Conversational Error:', error.message);
    res.status(500).json({
      status: false,
      error: error.message || 'Failed to get response from ChatGPT API'
    });
  }
}

module.exports = { meta, onStart };