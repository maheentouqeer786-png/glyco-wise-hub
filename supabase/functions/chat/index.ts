import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatRequest {
  message: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const groqApiKey = Deno.env.get('GROQ_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!groqApiKey) {
      return new Response(
        JSON.stringify({ error: 'Groq API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ChatRequest = await req.json();
    const { message } = body;

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Missing message in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl!, supabaseKey!);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    const { data: latestVitals } = await supabase
      .from('vitals')
      .select('*')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    const { data: recentMeals } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: false })
      .limit(5);

    const { data: chatHistory } = await supabase
      .from('chat_history')
      .select('*')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: true })
      .limit(10);

    const userContext = {
      name: userProfile?.name || 'User',
      age: userProfile?.age,
      weight: userProfile?.weight,
      diabetes_type: userProfile?.diabetes_type,
      has_bp: userProfile?.has_bp,
      has_heart_condition: userProfile?.has_heart_condition,
      latest_glucose: latestVitals?.glucose_level,
      latest_bp: latestVitals ? `${latestVitals.bp_systolic}/${latestVitals.bp_diastolic}` : null,
      recent_meals: recentMeals?.map(m => ({
        dish: m.dish_name,
        status: m.status,
        glucose_delta: m.glucose_delta,
      })),
    };

    const systemPrompt = `You are a professional health and nutrition AI assistant for GlycoCare+, a diabetes and cardiovascular health management app.\n\nYour role is to:\n- Provide personalized diet and nutrition advice\n- Help manage blood glucose levels\n- Offer recommendations for blood pressure and heart health\n- Suggest low-GI food alternatives\n- Explain meal impacts on health metrics\n- Provide actionable health tips\n\nContext about the user:\n${JSON.stringify(userContext, null, 2)}\n\nBe supportive, accurate, and concise. Always prioritize user safety and recommend consulting healthcare professionals for medical decisions.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(chatHistory || []).map((h: any) => ({
        role: h.role,
        content: h.message,
      })),
      { role: 'user', content: message },
    ];

    const { error: saveUserError } = await supabase
      .from('chat_history')
      .insert({
        user_id: user.id,
        role: 'user',
        message: message,
      });

    if (saveUserError) {
      console.error('Failed to save user message:', saveUserError);
    }

    console.log('Calling Groq API...');
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error('Groq API error:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Groq API request failed',
          details: errorText,
          status: groqResponse.status
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const groqResult = await groqResponse.json();
    const assistantMessage = groqResult.choices[0].message.content;

    const { error: saveAssistantError } = await supabase
      .from('chat_history')
      .insert({
        user_id: user.id,
        role: 'assistant',
        message: assistantMessage,
      });

    if (saveAssistantError) {
      console.error('Failed to save assistant message:', saveAssistantError);
    }

    const result = {
      message: assistantMessage,
      confidence: 0.9,
      recommendation: assistantMessage.split('.')[0],
    };

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in chat function:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});