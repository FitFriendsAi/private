import { pgTable, serial, text, integer, real, boolean, timestamp, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ─── User Profiles ────────────────────────────────────────────────────────────
export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  heightCm: real("height_cm"),
  birthDate: date("birth_date"),
  sex: text("sex"), // male | female | other
  activityLevel: text("activity_level").default("moderate"), // sedentary|light|moderate|active|very_active
  weightUnitPref: text("weight_unit_pref").default("lbs"), // lbs | kg
  volumeUnitPref: text("volume_unit_pref").default("oz"), // oz | ml
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({ id: true });
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;

// ─── Goals ────────────────────────────────────────────────────────────────────
export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // weight_loss | weight_gain | strength | body_comp
  label: text("label").notNull(),
  targetValue: real("target_value").notNull(), // grams for weight, grams for lifts
  unit: text("unit").notNull(), // lbs | kg | % (body fat)
  deadline: date("deadline"),
  startValue: real("start_value"),
  startDate: date("start_date"),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  exerciseId: integer("exercise_id"), // for strength goals
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true });
export type Goal = typeof goals.$inferSelect;
export type InsertGoal = z.infer<typeof insertGoalSchema>;

// ─── Body Measurements ────────────────────────────────────────────────────────
export const bodyMeasurements = pgTable("body_measurements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  weightGrams: real("weight_grams").notNull(),
  bodyFatPercent: real("body_fat_percent"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBodyMeasurementSchema = createInsertSchema(bodyMeasurements).omit({ id: true, createdAt: true });
export type BodyMeasurement = typeof bodyMeasurements.$inferSelect;
export type InsertBodyMeasurement = z.infer<typeof insertBodyMeasurementSchema>;

// ─── Food Items (cached database) ────────────────────────────────────────────
export const foodItems = pgTable("food_items", {
  id: serial("id").primaryKey(),
  barcode: text("barcode").unique(),
  name: text("name").notNull(),
  brand: text("brand"),
  servingSizeG: real("serving_size_g").notNull(),
  servingUnit: text("serving_unit").default("g"),
  calories: real("calories").notNull(),
  proteinG: real("protein_g").notNull().default(0),
  carbsG: real("carbs_g").notNull().default(0),
  fatG: real("fat_g").notNull().default(0),
  fiberG: real("fiber_g"),
  sodiumMg: real("sodium_mg"),
  sugarG: real("sugar_g"),
  source: text("source").default("custom"), // openfoodfacts | custom | scanned
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFoodItemSchema = createInsertSchema(foodItems).omit({ id: true, createdAt: true });
export type FoodItem = typeof foodItems.$inferSelect;
export type InsertFoodItem = z.infer<typeof insertFoodItemSchema>;

// ─── Food Log ─────────────────────────────────────────────────────────────────
export const foodLog = pgTable("food_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  mealType: text("meal_type").notNull(), // breakfast | lunch | dinner | snack
  foodItemId: integer("food_item_id").references(() => foodItems.id),
  foodName: text("food_name").notNull(), // denormalized for display
  servings: real("servings").notNull().default(1),
  caloriesActual: real("calories_actual").notNull(),
  proteinActual: real("protein_actual").notNull().default(0),
  carbsActual: real("carbs_actual").notNull().default(0),
  fatActual: real("fat_actual").notNull().default(0),
  fiberActual: real("fiber_actual"),
  notes: text("notes"),
  loggedAt: timestamp("logged_at").defaultNow(),
});

export const insertFoodLogSchema = createInsertSchema(foodLog).omit({ id: true, loggedAt: true });
export type FoodLogEntry = typeof foodLog.$inferSelect;
export type InsertFoodLogEntry = z.infer<typeof insertFoodLogSchema>;

// ─── Nutrition Targets ────────────────────────────────────────────────────────
export const nutritionTargets = pgTable("nutrition_targets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  effectiveDate: date("effective_date").notNull(),
  calories: real("calories").notNull(),
  proteinG: real("protein_g").notNull(),
  carbsG: real("carbs_g").notNull(),
  fatG: real("fat_g").notNull(),
  waterMl: real("water_ml").notNull().default(2500),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNutritionTargetSchema = createInsertSchema(nutritionTargets).omit({ id: true });
export type NutritionTarget = typeof nutritionTargets.$inferSelect;
export type InsertNutritionTarget = z.infer<typeof insertNutritionTargetSchema>;

// ─── Water Log ────────────────────────────────────────────────────────────────
export const waterLog = pgTable("water_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  amountMl: real("amount_ml").notNull(),
  loggedAt: timestamp("logged_at").defaultNow(),
});

export const insertWaterLogSchema = createInsertSchema(waterLog).omit({ id: true, loggedAt: true });
export type WaterLogEntry = typeof waterLog.$inferSelect;
export type InsertWaterLogEntry = z.infer<typeof insertWaterLogSchema>;

// ─── Supplement Log ───────────────────────────────────────────────────────────
export const supplementLog = pgTable("supplement_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  supplement: text("supplement").notNull(), // creatine | protein | pre_workout | vitamin | other
  amountG: real("amount_g"),
  notes: text("notes"),
  loggedAt: timestamp("logged_at").defaultNow(),
});

export const insertSupplementLogSchema = createInsertSchema(supplementLog).omit({ id: true, loggedAt: true });
export type SupplementLogEntry = typeof supplementLog.$inferSelect;
export type InsertSupplementLogEntry = z.infer<typeof insertSupplementLogSchema>;

// ─── Exercise Library ─────────────────────────────────────────────────────────
export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  primaryMuscle: text("primary_muscle").notNull(),
  secondaryMuscles: jsonb("secondary_muscles").$type<string[]>().default([]),
  category: text("category").notNull(), // compound | isolation | cardio | bodyweight
  equipment: text("equipment"), // barbell | dumbbell | machine | cable | bodyweight | none
  isCustom: boolean("is_custom").default(false),
  userId: integer("user_id"), // null = global, set = user-specific
  gifUrl: text("gif_url"),    // cached from ExerciseDB API
});

export const insertExerciseSchema = createInsertSchema(exercises).omit({ id: true });
export type Exercise = typeof exercises.$inferSelect;
export type InsertExercise = z.infer<typeof insertExerciseSchema>;

// ─── Workout Templates ────────────────────────────────────────────────────────
export const workoutTemplates = pgTable("workout_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkoutTemplateSchema = createInsertSchema(workoutTemplates).omit({ id: true, createdAt: true });
export type WorkoutTemplate = typeof workoutTemplates.$inferSelect;
export type InsertWorkoutTemplate = z.infer<typeof insertWorkoutTemplateSchema>;

// ─── Template Exercises ───────────────────────────────────────────────────────
export const templateExercises = pgTable("template_exercises", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => workoutTemplates.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
  orderIndex: integer("order_index").notNull(),
  targetSets: integer("target_sets").notNull().default(3),
  targetReps: text("target_reps").default("8-12"), // can be range like "8-12"
  targetWeightGrams: real("target_weight_grams"),
});

export const insertTemplateExerciseSchema = createInsertSchema(templateExercises).omit({ id: true });
export type TemplateExercise = typeof templateExercises.$inferSelect;
export type InsertTemplateExercise = z.infer<typeof insertTemplateExerciseSchema>;

// ─── Workouts (sessions) ──────────────────────────────────────────────────────
export const workouts = pgTable("workouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  templateId: integer("template_id").references(() => workoutTemplates.id),
  name: text("name").notNull(),
  notes: text("notes"),
  durationMinutes: integer("duration_minutes"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkoutSchema = createInsertSchema(workouts).omit({ id: true, createdAt: true });
export type Workout = typeof workouts.$inferSelect;
export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;

// ─── Heart Rate Log ───────────────────────────────────────────────────────────
export const heartRateLog = pgTable("heart_rate_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  /** Client-side epoch ms when the reading was taken */
  ts: timestamp("ts").notNull(),
  bpm: integer("bpm").notNull(),
});

export const insertHeartRateLogSchema = createInsertSchema(heartRateLog).omit({ id: true });
export type HeartRateLogEntry = typeof heartRateLog.$inferSelect;
export type InsertHeartRateLogEntry = z.infer<typeof insertHeartRateLogSchema>;

// ─── Saved Meals ──────────────────────────────────────────────────────────────
// A "meal" is a named collection of food items the user eats together regularly
// (e.g. "My usual breakfast", "Chicken & rice prep"). One tap logs all items.
export const savedMeals = pgTable("saved_meals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSavedMealSchema = createInsertSchema(savedMeals).omit({ id: true, createdAt: true });
export type SavedMeal = typeof savedMeals.$inferSelect;
export type InsertSavedMeal = z.infer<typeof insertSavedMealSchema>;

// Individual ingredients inside a saved meal
export const mealIngredients = pgTable("meal_ingredients", {
  id: serial("id").primaryKey(),
  mealId: integer("meal_id").notNull().references(() => savedMeals.id, { onDelete: "cascade" }),
  foodItemId: integer("food_item_id").references(() => foodItems.id),
  foodName: text("food_name").notNull(),   // denormalised for display without join
  servings: real("servings").notNull().default(1),
  caloriesActual: real("calories_actual").notNull(),
  proteinActual: real("protein_actual").notNull().default(0),
  carbsActual: real("carbs_actual").notNull().default(0),
  fatActual: real("fat_actual").notNull().default(0),
});

export const insertMealIngredientSchema = createInsertSchema(mealIngredients).omit({ id: true });
export type MealIngredient = typeof mealIngredients.$inferSelect;
export type InsertMealIngredient = z.infer<typeof insertMealIngredientSchema>;

// ─── Workout Sets ─────────────────────────────────────────────────────────────
export const workoutSets = pgTable("workout_sets", {
  id: serial("id").primaryKey(),
  workoutId: integer("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps").notNull(),
  weightGrams: real("weight_grams").notNull().default(0),
  rpe: real("rpe"), // rate of perceived exertion 1-10
  isWarmup: boolean("is_warmup").default(false),
  completedAt: timestamp("completed_at").defaultNow(),
});

export const insertWorkoutSetSchema = createInsertSchema(workoutSets).omit({ id: true });
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type InsertWorkoutSet = z.infer<typeof insertWorkoutSetSchema>;
