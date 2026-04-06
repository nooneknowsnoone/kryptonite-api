const axios = require('axios');
const fs = require('fs');

const meta = {
  name: 'ChatGPT Free (Conversational)',
  path: '/chatgpt-free-convo',
  method: ['get', 'post'],
  category: 'ai',
  params: [
    {
      name: 'prompt',
      desc: 'The text prompt to send to the model',
      example: 'Hello, how are you?',
      required: true
    },
    {
      name: 'uid',
      desc: 'Unique user ID for conversation history',
      example: 'user123',
      required: true
    },
    {
      name: 'model',
      desc: "Optional model key: 'chatgpt4' (default) or 'chatgpt3'",
      example: 'chatgpt4',
      required: false,
      options: ['chatgpt4', 'chatgpt3']
    }
  ]
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
  try {
    const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
    const key = `${uid}_${model}`;
    return convos[key] || [];
  } catch (error) {
    console.error('Error loading conversation:', error);
    return [];
  }
}

function saveConversation(uid, model, messages) {
  try {
    const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
    const key = `${uid}_${model}`;
    // Limit conversation history to last 20 messages to prevent token overflow
    convos[key] = messages.slice(-20);
    fs.writeFileSync(convoFile, JSON.stringify(convos, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving conversation:', error);
  }
}

function clearConversation(uid, model) {
  try {
    const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
    const key = `${uid}_${model}`;
    delete convos[key];
    fs.writeFileSync(convoFile, JSON.stringify(convos, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error clearing conversation:', error);
  }
}

async function onStart({ req, res }) {
  let prompt, uid, model;
  
  // Handle both GET and POST methods
  if (req.method === 'POST') {
    ({ prompt, uid, model } = req.body);
  } else {
    ({ prompt, uid, model } = req.query);
  }
  
  // Set default model if not provided
  model = model || 'chatgpt4';

  // Validate required parameters
  if (!prompt) {
    return res.status(400).json({ 
      error: 'Missing required parameter: prompt',
      status: false 
    });
  }

  if (!uid) {
    return res.status(400).json({ 
      error: 'Missing required parameter: uid',
      status: false,
      message: 'Please provide a unique user ID (uid) to maintain conversation history'
    });
  }

  // Validate model
  if (!model_list[model]) {
    return res.status(400).json({
      error: `Invalid model. Available models: ${Object.keys(model_list).join(', ')}`,
      status: false
    });
  }

  try {
    // Handle "clear" command to reset conversation
    if (prompt.toLowerCase() === 'clear' || prompt.toLowerCase() === '/clear') {
      clearConversation(uid, model);
      return res.json({ 
        status: true,
        message: 'Conversation history cleared successfully.',
        response: 'Conversation history has been reset.'
      });
    }

    // Load previous conversation history
    let conversation = loadConversation(uid, model);

    // Add new user message to history
    conversation.push({ role: 'user', content: prompt });

    // Build conversation context for the API
    let fullPrompt;
    if (conversation.length === 1) {
      // Single message, no history
      fullPrompt = prompt;
    } else {
      // Build context from previous exchanges
      const contextLines = [];
      for (let i = 0; i < conversation.length - 1; i++) {
        const msg = conversation[i];
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        contextLines.push(`${role}: ${msg.content}`);
      }
      contextLines.push(`User: ${prompt}`);
      contextLines.push(`Assistant:`);
      fullPrompt = contextLines.join('\n');
    }

    // Get cookies from referer
    let cookieHeader = undefined;
    try {
      const refererResp = await axios.get(model_list[model].referer, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
        }
      });
      const setCookie = refererResp.headers && refererResp.headers['set-cookie'];
      if (setCookie) {
        cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      }
    } catch (cookieError) {
      console.warn('Could not fetch cookies, continuing without:', cookieError.message);
    }

    // Make API request to ChatGPT
    const response = await axios.post(
      model_list[model].api,
      { prompt: fullPrompt },
      {
        timeout: 30000,
        headers: {
          'accept': '*/*',
          'content-type': 'application/json',
          'origin': 'https://stablediffusion.fr',
          'referer': model_list[model].referer,
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    // Extract answer from response
    let answer = 'No response received.';
    if (response.data) {
      answer = response.data.message || response.data.response || response.data.answer || JSON.stringify(response.data);
    }

    // Clean up the answer if needed (remove any extra formatting)
    if (typeof answer === 'string') {
      answer = answer.trim();
    }

    // Save assistant response to conversation history
    conversation.push({ role: 'assistant', content: answer });
    saveConversation(uid, model, conversation);

    // Return success response
    return res.json({
      status: true,
      response: answer,
      conversation_length: conversation.length / 2 // Number of exchanges
    });

  } catch (error) {
    console.error('ChatGPT Free Error:', error.message);
    
    // Handle specific error types
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        status: false,
        error: 'Request timeout - API took too long to respond'
      });
    }
    
    if (error.response) {
      return res.status(error.response.status || 500).json({
        status: false,
        error: `API returned error: ${error.response.status}`,
        details: error.response.data
      });
    }
    
    return res.status(500).json({
      status: false,
      error: error.message || 'Failed to get response from ChatGPT API'
    });
  }
}

module.exports = { meta, onStart };