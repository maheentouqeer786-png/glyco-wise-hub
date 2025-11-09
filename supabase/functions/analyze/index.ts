import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AnalyzeRequest {
  imageBase64: string;
  vitals: {
    glucose: string;
    systolic: string;
    diastolic: string;
    heartRate: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const hfToken = Deno.env.get('HUGGINGFACE_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!hfToken) {
      return new Response(
        JSON.stringify({ error: 'Hugging Face token not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: AnalyzeRequest = await req.json();
    const { imageBase64, vitals } = body;

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'Missing imageBase64 in request body' }),
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

    console.log('Classifying food...');
    const classifyResponse = await fetch(
      'https://api-inference.huggingface.co/models/Maheentouqeer1/food-classifier-efficientnet',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: imageBase64 }),
      }
    );

    if (!classifyResponse.ok) {
      const errorText = await classifyResponse.text();
      console.error('Classification failed:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Food classification failed',
          details: errorText,
          status: classifyResponse.status
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const classifyResult = await classifyResponse.json();
    console.log('Classification result:', classifyResult);

    let dish = 'unknown';
    let confidence = 0;

    if (Array.isArray(classifyResult) && classifyResult.length > 0) {
      dish = classifyResult[0].label;
      confidence = classifyResult[0].score;
    }

    console.log('Estimating portion...');
    let portionG = 200 + Math.random() * 100;

    try {
      const portionResponse = await fetch(
        'https://api-inference.huggingface.co/models/Maheentouqeer1/glycocare-portion-estimator',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: {
              image: imageBase64,
              dish_name: dish,
            },
          }),
        }
      );

      if (portionResponse.ok) {
        const portionResult = await portionResponse.json();
        if (typeof portionResult === 'number') {
          portionG = portionResult;
        } else if (portionResult.portion_g) {
          portionG = portionResult.portion_g;
        }
      }
    } catch (err) {
      console.log('Portion estimation failed, using fallback:', err);
    }

    portionG = Math.round(portionG);

    console.log('Predicting glucose delta...');
    const currentGlucose = parseFloat(vitals.glucose);
    let glucoseDelta = 15;

    try {
      const regressionResponse = await fetch(
        'https://api-inference.huggingface.co/models/Maheentouqeer1/glycocare-glucose-regression',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: {
              dish_name: dish,
              portion_g: portionG,
              current_glucose: currentGlucose,
              age: userProfile?.age || 30,
              weight: userProfile?.weight || 70,
              has_diabetes: userProfile?.diabetes_type !== null,
            },
          }),
        }
      );

      if (regressionResponse.ok) {
        const regressionResult = await regressionResponse.json();
        if (typeof regressionResult === 'number') {
          glucoseDelta = regressionResult;
        } else if (regressionResult.glucose_delta) {
          glucoseDelta = regressionResult.glucose_delta;
        }
      } else {
        const highCarbFoods = ['biryani', 'rice', 'pasta', 'bread', 'noodles', 'potato', 'pizza'];
        const mediumCarbFoods = ['chicken', 'fish', 'curry', 'dal', 'beans'];
        const dishLower = dish.toLowerCase();

        let carbPercentage = 0.2;
        if (highCarbFoods.some(food => dishLower.includes(food))) {
          carbPercentage = 0.5;
        } else if (mediumCarbFoods.some(food => dishLower.includes(food))) {
          carbPercentage = 0.3;
        }

        const carbEstimate = portionG * carbPercentage;
        glucoseDelta = carbEstimate * 0.15 * (userProfile?.diabetes_type ? 1.5 : 1);
      }
    } catch (err) {
      console.log('Glucose prediction failed, using fallback:', err);
    }

    glucoseDelta = Math.round(glucoseDelta * 10) / 10;

    const predictedGlucose = currentGlucose + glucoseDelta;
    let status = 'normal';

    if (predictedGlucose >= 180 || glucoseDelta >= 40) {
      status = 'high';
    } else if (predictedGlucose >= 140 || glucoseDelta >= 20) {
      status = 'borderline';
    }

    const adviceTemplates = {
      high: [
        `This ${dish} will cause a significant glucose spike (+${glucoseDelta} mg/dL). Consider eating half the portion and adding more vegetables.`,
        `High glucose impact detected. This meal may not be suitable given your current glucose levels. Consider a lower-carb alternative.`,
      ],
      borderline: [
        `Moderate glucose impact (+${glucoseDelta} mg/dL). Consider taking a 10-minute walk after eating to help regulate glucose.`,
        `This meal is acceptable but could be improved. Try reducing the portion size by 25% or adding more fiber-rich vegetables.`,
      ],
      normal: [
        `Good choice! This meal should have a manageable impact on your glucose (+${glucoseDelta} mg/dL).`,
        `This is a well-balanced meal for your health goals. Maintain this portion size for optimal results.`,
      ],
    };

    const templates = adviceTemplates[status] || adviceTemplates.normal;
    let advice = templates[Math.floor(Math.random() * templates.length)];

    if (userProfile?.has_bp) {
      advice += ' Monitor sodium intake as you have blood pressure concerns.';
    }

    if (userProfile?.has_heart_condition) {
      advice += ' Choose lean proteins and healthy fats for heart health.';
    }

    const { error: mealError } = await supabase
      .from('meals')
      .insert({
        user_id: user.id,
        dish_name: dish,
        portion_g: portionG,
        glucose_delta: glucoseDelta,
        confidence: confidence,
        advice: advice,
        status: status,
      });

    if (mealError) {
      console.error('Failed to save meal:', mealError);
    }

    if (vitals) {
      const { error: vitalsError } = await supabase
        .from('vitals')
        .insert({
          user_id: user.id,
          glucose_level: currentGlucose,
          bp_systolic: parseInt(vitals.systolic),
          bp_diastolic: parseInt(vitals.diastolic),
          heart_rate: parseInt(vitals.heartRate),
        });

      if (vitalsError) {
        console.error('Failed to save vitals:', vitalsError);
      }
    }

    const result = {
      dish,
      portion_g: portionG,
      predicted_glucose_delta: glucoseDelta,
      confidence: Math.round(confidence * 100),
      advice,
      status,
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
    console.error('Error in analyze function:', error);
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