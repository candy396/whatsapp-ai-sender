const OpenAI = require('openai');
require('dotenv').config();

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Replace placeholders in template text with client data safely.
 * e.g., "Hello {name} from {company}" -> "Hello John from Acme Corp"
 */
function interpolateTemplate(template, clientData = {}) {
  if (!template) return '';
  let result = template;
  for (const [key, value] of Object.entries(clientData)) {
    if (!key) continue;
    const cleanKey = String(key).replace(/^\uFEFF/, '').trim();
    if (!cleanKey) continue;
    // Escape special regex characters in the placeholder key name
    const escapedKey = cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const placeholder = new RegExp(`\\{${escapedKey}\\}`, 'gi');
    result = result.replace(placeholder, value !== undefined && value !== null ? String(value) : '');
  }
  return result;
}

/**
 * Generate customized AI message using OpenAI or standard template fallback
 */
async function generateAIMessage({ template, clientData, promptInstruction, useAI = true, apiKey = null }) {
  // First substitute variables in template
  const baseMessage = interpolateTemplate(template, clientData);

  const activeApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!useAI || !activeApiKey) {
    // If AI is disabled or API key missing, return template with variables replaced
    return baseMessage;
  }

  const clientAi = apiKey ? new OpenAI({ apiKey }) : openai;

  try {
    const systemPrompt = `You are a professional WhatsApp communication assistant.
Your job is to personalize and format messages to clients.
Guidelines:
- Keep the message warm, engaging, and professional.
- Preserve all key information (dates, names, links, specific offers).
- Keep formatting readable on WhatsApp (use line breaks and subtle emoji if appropriate).
- Output ONLY the final message content ready to send to WhatsApp. Do not include quotes around the output or meta commentary.`;

    const userContent = `Client details: ${JSON.stringify(clientData)}
Base Template / Outline: "${baseMessage}"
Instruction: ${promptInstruction || process.env.DEFAULT_AI_PROMPT || 'Refine this message for natural, friendly messaging on WhatsApp.'}`;

    const response = await clientAi.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const aiMessage = response.choices[0]?.message?.content?.trim();
    return aiMessage || baseMessage;
  } catch (error) {
    console.error('AI Generation Warning:', error.message);
    // Fallback to base interpolated message if AI fails
    return baseMessage;
  }
}

module.exports = {
  interpolateTemplate,
  generateAIMessage
};
