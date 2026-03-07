import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/**
 * AI Hourly Productivity Logger
 * Automates: Finding active shift -> Generating report via AI -> Logging Productivity
 */

const SUPABASE_URL = "https://lyltstsxwtlfgihdbmux.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DAILY_GOAL = ' Analyzed requirements for social media database structure and automation workflow. Designed the database schema for storing social media posts and scheduling data. Created tables and fields for posts, platforms, scheduling time, and status tracking. Configured database connections and tested basic data insertion and retrieval. Set up the initial n8n workflow for social media automation. Integrated the database with the n8n workflow to fetch scheduled posts. Implemented automation logic for posting content to different social media platforms. Added error handling and status updates for successful or failed posts. Tested the complete automation workflow and optimized the database queries and workflow performance.'
async function run() {
    // 1. Calculate IST Time & Dates
    const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentHour = istNow.getHours();

    // We log for the hour that JUST finished.
    // If it is 11:00 AM, we log for the 10:00 AM - 11:00 AM block.
    const logHourStart = currentHour - 1;
    const logHourEnd = currentHour;
    const todayDate = istNow.toISOString().split('T')[0];

    // Workday: 10 AM to 6 PM.
    // Reporting Window: 11 AM (logs 10-11) to 7 PM (logs 6-7).
    if (currentHour < 11 || currentHour > 19) {
        console.log(`Current IST hour (${currentHour}) is outside reporting window (11:00 AM - 7:00 PM).`);
        return;
    }

    const email = process.env.MY_EMAIL || "ali.ameen@pixoranest.com";
    const password = process.env.MY_PASSWORD || "Ali.ameen@pixoranest01";
    const dailyGoal = process.env.DAILY_GOAL || DAILY_GOAL;

    if (!email || !password) throw new Error("Missing credentials.");

    // Task #1 is the 10 AM block, reported at 11 AM.
    const taskNumber = currentHour - 10;

    console.log(`Reporting for Hour Block: ${logHourStart}:00 to ${logHourEnd}:00 (Task #${taskNumber} of 9)`);
    console.log(`Goal: "${dailyGoal}"`);


    // 2. Auth
    const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) throw authErr;
    const userId = auth.user.id;

    // 3. Find Active Shift for Today
    const { data: shift, error: shiftErr } = await supabase
        .from('shifts')
        .select('id')
        .eq('user_id', userId)
        .eq('date', todayDate)
        .eq('status', 'active')
        .maybeSingle();

    if (shiftErr) throw shiftErr;
    if (!shift) {
        console.log("No active shift found. Please ensure you are clocked in!");
        return;
    }

    console.log(`Generating AI productivity log for period ending at ${logHourEnd}:00...`);

    // 4. GPT: Generate Productivity Details
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are a professional employee. You are reporting what you DID in the last 60 minutes." },
            {
                role: "user", content: `Daily Goal: "${dailyGoal}". 
        Reporting for Hour #${taskNumber} (Time: ${logHourStart}:00 to ${logHourEnd}:00).
        
        Provide a specific, result-oriented description of what was accomplished in this EXACT hour.
        Return JSON: {"work_description": "...", "productivity_score": 85, "productivity_level": "highly_productive|productive|moderate|low"} but not like staff 'During the hour from 10:00 to 11:00' ,directly define task , and its should be 20 words max` }
        ],
        response_format: { type: "json_object" }
    });


    const aiResult = JSON.parse(response.choices[0].message.content);
    console.log("AI Generated Log:", aiResult);

    // 5. Upsert Hourly Productivity Log (Prevents "duplicate key" error)
    const { error: logErr } = await supabase.from('hourly_productivity_logs').upsert({
        user_id: userId,
        shift_id: shift.id,
        date: todayDate,
        hour_start: `${logHourStart}:00`,
        hour_end: `${logHourEnd}:00`,
        work_description: aiResult.work_description,
        productivity_score: aiResult.productivity_score,
        productivity_level: aiResult.productivity_level.toLowerCase(),
        is_break: false,
        is_overtime: logHourStart >= 18,
        tasks_worked_on: [aiResult.work_description.split(' ').slice(0, 3).join(' ')]
    }, { onConflict: 'user_id, shift_id, hour_start' });


    if (logErr) throw logErr;
    console.log(`✅ Successfully Logged Hour #${taskNumber}!`);

}

run().catch(err => {
    console.error("Critical Error:", err.message);
    process.exit(1);
});


