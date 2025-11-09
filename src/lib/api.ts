import { authService } from '@/services/auth';
import { vitalsService } from '@/services/vitals';
import { mealsService } from '@/services/meals';
import { chatService } from '@/services/chat';
import { huggingFaceService } from '@/services/huggingface';

export interface DashboardData {
  glucose: number;
  systolic: number;
  diastolic: number;
  heartRate: number;
  latestMeal?: {
    dish: string;
    portion: number;
    glucoseDelta: number;
    timestamp: string;
  };
}

export interface AnalyzeResult {
  dish: string;
  portion: number;
  predictedDelta: number;
  confidence: number;
  advice: string;
  status: "normal" | "borderline" | "high";
  tips: string[];
  foodSwaps: string[];
}

export interface MealPlan {
  day: string;
  breakfast: string;
  lunch: string;
  dinner: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export const fetchDashboard = async (userId: string): Promise<DashboardData> => {
  try {
    const latestVitals = await vitalsService.getLatestVitals(userId);
    const latestMeal = await mealsService.getLatestMeal(userId);

    return {
      glucose: latestVitals?.glucose_level || 120,
      systolic: latestVitals?.bp_systolic || 120,
      diastolic: latestVitals?.bp_diastolic || 80,
      heartRate: latestVitals?.heart_rate || 75,
      latestMeal: latestMeal ? {
        dish: latestMeal.dish_name,
        portion: latestMeal.portion_g || 0,
        glucoseDelta: latestMeal.glucose_delta || 0,
        timestamp: latestMeal.timestamp || new Date().toISOString(),
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return {
      glucose: 120,
      systolic: 120,
      diastolic: 80,
      heartRate: 75,
    };
  }
};

export const analyzeMeal = async (image: File, vitals: any): Promise<AnalyzeResult> => {
  try {
    const reader = new FileReader();
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(image);
    });

    // Get auth token from supabase
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('User not authenticated');
    }

    // Call the Edge Function
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const response = await fetch(`${supabaseUrl}/functions/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        imageBase64,
        vitals,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to analyze meal');
    }

    const result = await response.json();

    // Generate tips and food swaps client-side
    const tips = generateTips(result.status, result.predicted_glucose_delta);
    const foodSwaps = generateFoodSwaps(result.dish);

    return {
      dish: result.dish,
      portion: result.portion_g,
      predictedDelta: result.predicted_glucose_delta,
      confidence: result.confidence,
      advice: result.advice,
      status: result.status,
      tips,
      foodSwaps,
    };
  } catch (error) {
    console.error('Error analyzing meal:', error);
    throw error;
  }
};

export const saveMeal = async (mealData: any): Promise<boolean> => {
  try {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    await mealsService.saveMeal({
      user_id: user.id,
      dish_name: mealData.dish,
      portion_g: mealData.portion,
      glucose_delta: mealData.predictedDelta,
      confidence: mealData.confidence / 100,
      advice: mealData.advice,
      status: mealData.status,
    });

    if (mealData.vitals) {
      await vitalsService.saveVitals({
        user_id: user.id,
        glucose_level: parseFloat(mealData.vitals.glucose),
        bp_systolic: parseInt(mealData.vitals.systolic),
        bp_diastolic: parseInt(mealData.vitals.diastolic),
        heart_rate: parseInt(mealData.vitals.heartRate),
      });
    }

    return true;
  } catch (error) {
    console.error('Error saving meal:', error);
    return false;
  }
};

export const fetchMealPlan = async (): Promise<MealPlan[]> => {
  try {
    // Get auth token from supabase
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('User not authenticated');
    }

    // Call the Edge Function
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const response = await fetch(`${supabaseUrl}/functions/v1/planner`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch meal plan');
    }

    const result = await response.json();
    return result.weekly_plan;
  } catch (error) {
    console.error('Error fetching meal plan:', error);
    return generateDefaultMealPlan();
  }
};

export const regenerateMealPlan = async (): Promise<MealPlan[]> => {
  return fetchMealPlan();
};

export const sendChatMessage = async (message: string, history: ChatMessage[]): Promise<string> => {
  try {
    // Get auth token from supabase
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('User not authenticated');
    }

    // Call the Edge Function
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to send chat message');
    }

    const result = await response.json();
    return result.message;
  } catch (error) {
    console.error('Error sending chat message:', error);
    return "I'm having trouble connecting right now. Please try again in a moment.";
  }
};

function generateTips(status: string, glucoseDelta: number): string[] {
  const tips = [];

  if (status === 'high') {
    tips.push('Take a 15-minute walk after eating');
    tips.push('Drink plenty of water');
    tips.push('Monitor glucose every 2 hours');
  } else if (status === 'borderline') {
    tips.push('Take a 10-minute walk after eating');
    tips.push('Drink water with your meal');
    tips.push('Monitor glucose after 2 hours');
  } else {
    tips.push('Maintain this portion size');
    tips.push('Stay hydrated throughout the day');
    tips.push('Continue making healthy choices');
  }

  return tips;
}

function generateFoodSwaps(dish: string): string[] {
  const swaps = [];
  const dishLower = dish.toLowerCase();

  if (dishLower.includes('rice') || dishLower.includes('biryani')) {
    swaps.push('Replace white rice with brown rice or quinoa');
    swaps.push('Add more vegetables to reduce rice portion');
  }

  if (dishLower.includes('bread') || dishLower.includes('roti')) {
    swaps.push('Choose whole grain bread instead');
    swaps.push('Reduce portion size by half');
  }

  if (dishLower.includes('fried')) {
    swaps.push('Try grilled or baked version');
    swaps.push('Use air fryer instead of deep frying');
  }

  if (swaps.length === 0) {
    swaps.push('Add more leafy greens');
    swaps.push('Use healthier cooking oils');
    swaps.push('Reduce salt and sugar content');
  }

  return swaps;
}

function generateMealPlan(user: any, vitalsSum: any, mealStats: any): MealPlan[] {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const lowGIBreakfast = [
    'Steel-cut oatmeal with berries and almonds',
    'Greek yogurt with chia seeds and walnuts',
    'Scrambled eggs with spinach and whole grain toast',
    'Smoothie bowl with flaxseeds and fresh berries',
  ];

  const lowGILunch = [
    'Grilled chicken salad with olive oil dressing',
    'Lentil soup with mixed vegetables',
    'Quinoa bowl with roasted vegetables and chickpeas',
    'Grilled fish with steamed broccoli and brown rice',
  ];

  const lowGIDinner = [
    'Baked salmon with asparagus and sweet potato',
    'Chicken stir-fry with lots of vegetables',
    'Vegetable curry with cauliflower rice',
    'Turkey meatballs with zucchini noodles',
  ];

  return days.map((day, index) => ({
    day,
    breakfast: lowGIBreakfast[index % lowGIBreakfast.length],
    lunch: lowGILunch[index % lowGILunch.length],
    dinner: lowGIDinner[index % lowGIDinner.length],
  }));
}

function generateDefaultMealPlan(): MealPlan[] {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return days.map((day) => ({
    day,
    breakfast: 'Oatmeal with berries and nuts',
    lunch: 'Grilled chicken salad with olive oil',
    dinner: 'Baked salmon with steamed vegetables',
  }));
}
