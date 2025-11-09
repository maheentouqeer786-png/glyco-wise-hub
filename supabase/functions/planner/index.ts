import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: vitalsData } = await supabase
      .from('vitals')
      .select('*')
      .eq('user_id', user.id)
      .gte('timestamp', sevenDaysAgo.toISOString())
      .order('timestamp', { ascending: false });

    const { data: mealsData } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', user.id)
      .gte('timestamp', sevenDaysAgo.toISOString())
      .order('timestamp', { ascending: false });

    const avgGlucose = vitalsData && vitalsData.length > 0
      ? vitalsData.reduce((sum, v) => sum + (v.glucose_level || 0), 0) / vitalsData.length
      : 0;

    const avgBpSystolic = vitalsData && vitalsData.length > 0
      ? vitalsData.reduce((sum, v) => sum + (v.bp_systolic || 0), 0) / vitalsData.length
      : 0;

    const avgBpDiastolic = vitalsData && vitalsData.length > 0
      ? vitalsData.reduce((sum, v) => sum + (v.bp_diastolic || 0), 0) / vitalsData.length
      : 0;

    const avgGlucoseChange = mealsData && mealsData.length > 0
      ? mealsData.reduce((sum, m) => sum + (m.glucose_delta || 0), 0) / mealsData.length
      : 0;

    const healthyMealsCount = mealsData ? mealsData.filter(m => m.status === 'normal').length : 0;
    const totalMeals = mealsData ? mealsData.length : 0;
    const healthyMealsRatio = totalMeals > 0 ? healthyMealsCount / totalMeals : 0;

    const lowGIBreakfast = [
      'Steel-cut oatmeal with berries and almonds',
      'Greek yogurt with chia seeds and walnuts',
      'Scrambled eggs with spinach and whole grain toast',
      'Smoothie bowl with flaxseeds and fresh berries',
      'Avocado toast on whole grain bread with poached egg',
      'Cottage cheese with cucumber and tomatoes',
      'Protein pancakes with sugar-free syrup and berries',
    ];

    const lowGILunch = [
      'Grilled chicken salad with olive oil dressing',
      'Lentil soup with mixed vegetables',
      'Quinoa bowl with roasted vegetables and chickpeas',
      'Grilled fish with steamed broccoli and brown rice',
      'Turkey and avocado wrap in whole wheat tortilla',
      'Vegetable stir-fry with tofu and cauliflower rice',
      'Chicken breast with sweet potato and green beans',
    ];

    const lowGIDinner = [
      'Baked salmon with asparagus and sweet potato',
      'Chicken stir-fry with lots of vegetables',
      'Vegetable curry with cauliflower rice',
      'Turkey meatballs with zucchini noodles',
      'Grilled lean beef with roasted Brussels sprouts',
      'Baked cod with quinoa and steamed vegetables',
      'Chicken soup with vegetables and barley',
    ];

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weeklyPlan = days.map((day, index) => ({
      day,
      breakfast: lowGIBreakfast[index % lowGIBreakfast.length],
      lunch: lowGILunch[index % lowGILunch.length],
      dinner: lowGIDinner[index % lowGIDinner.length],
    }));

    const result = {
      weekly_plan: weeklyPlan,
      summary: {
        avg_glucose: Math.round(avgGlucose * 10) / 10,
        avg_glucose_change: Math.round(avgGlucoseChange * 10) / 10,
        avg_bp: `${Math.round(avgBpSystolic)}/${Math.round(avgBpDiastolic)}`,
        healthy_meals_ratio: Math.round(healthyMealsRatio * 100) / 100,
        total_meals: totalMeals,
        recommendations: [
          avgGlucose > 140 ? 'Focus on low-GI foods to reduce average glucose' : 'Your glucose levels are well-managed',
          avgBpSystolic > 130 ? 'Reduce sodium intake to lower blood pressure' : 'Your blood pressure is in a good range',
          healthyMealsRatio < 0.7 ? 'Try to increase the proportion of healthy meals' : 'Great job maintaining healthy eating habits!',
        ],
      },
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
    console.error('Error in planner function:', error);
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