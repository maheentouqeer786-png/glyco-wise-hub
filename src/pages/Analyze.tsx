import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, TrendingUp, Volume2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { analyzeMeal, saveMeal, AnalyzeResult } from "@/lib/api";

const Analyze = () => {
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [vitals, setVitals] = useState({
    glucose: "145",
    systolic: "138",
    diastolic: "88",
    heartRate: "92",
  });
  const { toast } = useToast();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    
    try {
      const analysisResult = await analyzeMeal(file, vitals);
      setResult(analysisResult);
      toast({
        title: "Analysis complete",
        description: "Meal analyzed and saved to your history",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to analyze meal",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveMeal = async () => {
    if (!result) return;
    
    setSaving(true);
    try {
      await saveMeal({
        ...result,
        vitals,
      });
      toast({
        title: "Meal saved",
        description: "Your meal has been saved to history",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save meal",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVoiceAdvice = () => {
    // TODO: Implement TTS
    toast({
      title: "Voice advice",
      description: "Text-to-speech feature coming soon!",
    });
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Meal Analyzer</h1>
          <p className="text-muted-foreground">Upload a meal photo for instant AI analysis</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle>Upload Meal Photo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary transition-colors">
                <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <Label htmlFor="meal-upload" className="cursor-pointer">
                  <span className="text-primary hover:underline">Click to upload</span> or drag and drop
                  <p className="text-sm text-muted-foreground mt-2">PNG, JPG up to 10MB</p>
                </Label>
                <Input
                  id="meal-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                />
              </div>

              {analyzing && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Analyzing your meal...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Current Vitals */}
          <Card>
            <CardHeader>
              <CardTitle>Current Vitals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="glucose">Current Glucose (mg/dL)</Label>
                <Input
                  id="glucose"
                  type="number"
                  value={vitals.glucose}
                  onChange={(e) => setVitals({ ...vitals, glucose: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="systolic">Systolic (mmHg)</Label>
                  <Input
                    id="systolic"
                    type="number"
                    value={vitals.systolic}
                    onChange={(e) => setVitals({ ...vitals, systolic: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="diastolic">Diastolic (mmHg)</Label>
                  <Input
                    id="diastolic"
                    type="number"
                    value={vitals.diastolic}
                    onChange={(e) => setVitals({ ...vitals, diastolic: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="heartRate">Heart Rate (BPM)</Label>
                <Input
                  id="heartRate"
                  type="number"
                  value={vitals.heartRate}
                  onChange={(e) => setVitals({ ...vitals, heartRate: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        {result && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Analysis Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Detected Dish</p>
                  <p className="text-2xl font-semibold">{result.dish}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Portion Size</p>
                  <p className="text-2xl font-semibold">{result.portion}g</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Predicted Glucose Delta</p>
                  <p className="text-2xl font-semibold text-warning flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    +{result.predictedDelta} mg/dL
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">AI Confidence</p>
                  <p className="text-2xl font-semibold text-primary">{result.confidence}%</p>
                </div>
              </div>

              {/* Status Banner */}
              <div
                className={`p-4 rounded-lg border-2 ${
                  result.status === "high"
                    ? "bg-destructive/10 border-destructive/20"
                    : result.status === "borderline"
                    ? "bg-warning/10 border-warning/20"
                    : "bg-success/10 border-success/20"
                }`}
              >
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  {result.status === "high" ? "🔴" : result.status === "borderline" ? "⚠️" : "✅"}
                  {result.status === "high" ? " High Risk Meal" : result.status === "borderline" ? " Moderate - Eat in Control" : " Safe Choice"}
                </h3>
                <p className="text-sm">{result.advice}</p>
              </div>

              {/* Tips */}
              {result.tips && result.tips.length > 0 && (
                <div className="bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">💡 Quick Tips</h4>
                  <ul className="space-y-1">
                    {result.tips.map((tip, index) => (
                      <li key={index} className="text-sm flex items-start gap-2">
                        <span className="text-primary">•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Food Swaps */}
              {result.foodSwaps && result.foodSwaps.length > 0 && (
                <div className="bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">🔄 Healthier Alternatives</h4>
                  <ul className="space-y-1">
                    {result.foodSwaps.map((swap, index) => (
                      <li key={index} className="text-sm flex items-start gap-2">
                        <span className="text-primary">•</span>
                        {swap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-4">
                <Button onClick={handleSaveMeal} disabled={saving} className="flex-1 gap-2">
                  <Save className="h-4 w-4" />
                  {saving ? "Saving..." : "Save Meal"}
                </Button>
                <Button variant="outline" onClick={handleVoiceAdvice} className="flex-1 gap-2">
                  <Volume2 className="h-4 w-4" />
                  Voice Advice
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Analyze;
