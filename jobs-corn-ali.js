import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/**
 * AI Hourly Productivity Logger
 * Automates: Finding active shift -> Generating report via AI -> Logging Productivity
 */

const SUPABASE_URL = "https://lyltstsxwtlfgihdbmux.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

const DAILY_GOAL = "1. Built the n8n webhook to receive client topic input from form or WhatsApp message. 2. Connected the OpenAI GPT node to generate caption, description, and hashtags based on the client topic. , working on gemini api integratiion ,content generation [this task is big so divide in 3 hours atleast]."
async function run() {
    // 1. Calculate IST Time & Dates
    const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentHour = istNow.getHours();
    const currentMinutes = istNow.getMinutes();
    const dayOfWeek = istNow.getDay(); // 0 is Sunday
    const todayDate = istNow.toISOString().split('T')[0];

    // Workday Check: Monday to Saturday ONLY
    if (dayOfWeek === 0) {
        console.log("It's Sunday! No automation today.");
        return;
    }

    // Workday: 10 AM to 7 PM IST.
    if (currentHour < 10 || currentHour > 19) {
        console.log(`Current IST hour (${currentHour}) is outside workday window (10:00 AM - 7:05 PM).`);
        return;
    }

    const email = process.env.MY_EMAIL || "ali.ameen@pixoranest.com";
    const password = process.env.MY_PASSWORD || "Ali.ameen@pixoranest01";
    const dailyGoal = process.env.DAILY_GOAL || DAILY_GOAL;

    if (!email || !password) throw new Error("Missing credentials.");

    // 2. Auth
    const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) throw authErr;
    const userId = auth.user.id;

    // 3. Handle Clock In (10:00 AM)
    if (currentHour === 10) {
        console.log("Checking for Clock In...");
        const { data: existingShift } = await supabase
            .from('shifts')
            .select('id')
            .eq('user_id', userId)
            .eq('date', todayDate)
            .maybeSingle();

        if (!existingShift) {
            const { error: insertErr } = await supabase.from('shifts').insert({
                user_id: userId,
                date: todayDate,
                status: 'active'
            });
            if (insertErr) throw insertErr;
            console.log("✅ Successfully Clocked In at 10:00 AM IST!");
        } else {
            console.log("Already clocked in for today.");
        }

        // At 10 AM, we just clock in. Reporting starts at 11 AM (for the 10-11 block).
        return;
    }

    // 4. Find Active Shift for Reporting & Clock Out
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

    // 5. Reporting Logic (11 AM to 7 PM IST)
    const logHourStart = currentHour - 1;
    const logHourEnd = currentHour;
    const taskNumber = currentHour - 10;

    console.log(`Reporting for Hour Block: ${logHourStart}:00 to ${logHourEnd}:00 (Task #${taskNumber} of 9)`);

    // Check if log already exists for this hour to avoid redundant AI calls
    const { data: existingLog } = await supabase
        .from('hourly_productivity_logs')
        .select('id')
        .eq('user_id', userId)
        .eq('shift_id', shift.id)
        .eq('hour_start', `${logHourStart}:00`)
        .maybeSingle();

    if (existingLog) {
        console.log(`✅ Log already exists for Hour #${taskNumber}. Skipping OpenAI generation.`);
    } else {
        console.log(`Generating AI productivity log for period ending at ${logHourEnd}:00...`);

        // GPT: Generate Productivity Details
        const response = await openai.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a professional employee. You are reporting what you DID in the last 60 minutes." },
                {
                    role: "user", content: `Daily Goal: "${dailyGoal}". 
            Reporting for Hour #${taskNumber} (Time: ${logHourStart}:00 to ${logHourEnd}:00).
            
            Provide a specific, result-oriented description of what was accomplished in this EXACT hour.
            Return JSON: {"work_description": "...", "productivity_score": 85, "productivity_level": "productive|moderate|low"} but not like staff 'During the hour from 10:00 to 11:00' ,directly define task , and its should be 20 words max` }
            ],
            response_format: { type: "json_object" }
        });

        const aiResult = JSON.parse(response.choices[0].message.content);
        console.log("AI Generated Log:", aiResult);

        // Upsert Hourly Productivity Log
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

    // 6. Handle Clock Out (7:00 PM IST)
    if (currentHour === 19) {
        console.log("Clocking Out...");
        const { error: updateErr } = await supabase
            .from('shifts')
            .update({ status: 'completed' })
            .eq('id', shift.id);

        if (updateErr) throw updateErr;
        console.log("✅ Successfully Clocked Out at 7:00 PM IST!");
    }
}

run().catch(err => {
    console.error("Critical Error:", err.message);
    process.exit(1);
});


