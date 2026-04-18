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

const DAILY_GOAL = "Today i am working on creating database schema for the social media automation platform it includes tables for users, posts, comments, likes, followers, following, messages, notifications, and more. The structure includes planning for automation workflows, account management, scheduling system, and message handling. This blueprint will guide the development of the backend, APIs, and automation logic."
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

        // Find ANY shift for this user that is blocking (actual_end is NULL and actual_start is NOT NULL)
        const { data: blockingShift } = await supabase
            .from('shifts')
            .select('id, date, actual_start')
            .eq('user_id', userId)
            .is('actual_end', null)
            .not('actual_start', 'is', null)
            .maybeSingle();

        if (blockingShift) {
            console.log(`Found blocking shift from ${blockingShift.date} (ID: ${blockingShift.id}). Auto-closing it first...`);
            const actualEnd = new Date(blockingShift.date + 'T19:00:00+05:30');
            const { error: closeErr } = await supabase
                .from('shifts')
                .update({ 
                    status: 'completed', 
                    actual_end: actualEnd.toISOString(),
                    auto_closed: true,
                    auto_close_note: 'Auto-closed by morning job because user forgot to checkout'
                })
                .eq('id', blockingShift.id);
            
            if (closeErr) throw closeErr;

            // Also update attendance for the forgotten shift
            const actualStart = new Date(blockingShift.actual_start);
            const workHours = (actualEnd - actualStart) / (1000 * 60 * 60);
            const overtimeHours = Math.max(0, workHours - 9);

            await supabase
                .from('attendance')
                .upsert({
                    user_id: userId,
                    shift_id: blockingShift.id,
                    date: blockingShift.date,
                    status: 'present',
                    total_hours: parseFloat(workHours.toFixed(2)),
                    overtime_hours: parseFloat(overtimeHours.toFixed(2))
                }, { onConflict: 'user_id, date' });

            console.log(`✅ Auto-closed previous shift ${blockingShift.id} and updated attendance.`);
        }

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
                status: 'active',
                actual_start: new Date().toISOString()
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
        .select('id, actual_start, total_break_minutes')
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
        const goalParts = dailyGoal.split(/[,.]/).map(g => g.trim()).filter(g => g.length > 5);
        const taskIndex = (taskNumber - 1) % (goalParts.length || 1);
        const focusTask = goalParts[taskIndex] || dailyGoal;

        console.log(`Generating AI productivity log for period ending at ${logHourEnd}:00 (Focus: ${focusTask})...`);

        // GPT: Generate Productivity Details
        const response = await openai.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a professional software engineer. You are reporting what you DID in the last 60 minutes. Be specific, professional, and vary your descriptions for each hour." },
                {
                    role: "user", content: `Context: You are working on this specifically: "${focusTask}".
            Overall Daily Goal: "${dailyGoal}". 
            Reporting for Hour #${taskNumber} of 9 (Time: ${logHourStart}:00 to ${logHourEnd}:00).
            
            IMPORTANT: Provide a unique, result-oriented description of what was accomplished in this EXACT hour related to the focus task. 
            Do NOT repeat previous reports. Focus on a specific sub-component or progress milestone. 
            Use varied professional terminology (e.g., 'Implemented', 'Optimized', 'Debugged', 'Integrated', 'Refined').
            
            The description must be under 20 words and directly state the work.
            Return JSON: {"work_description": "...", "productivity_score": 90, "productivity_level": "productive"}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.8
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
            productivity_level: (aiResult.productivity_level || "productive").toLowerCase(),
            is_break: false,
            is_overtime: logHourStart >= 18,
            tasks_worked_on: [aiResult.work_description.split(' ').slice(0, 5).join(' ')]
        }, { onConflict: 'user_id, shift_id, hour_start' });

        if (logErr) throw logErr;
        console.log(`✅ Successfully Logged Hour #${taskNumber}!`);
    }

    // 6. Handle Clock Out (7:00 PM IST)
    if (currentHour === 19) {
        console.log("Clocking Out...");

        const actualStart = new Date(shift.actual_start);
        const actualEnd = new Date();
        const workHours = (actualEnd - actualStart) / (1000 * 60 * 60);
        const overtimeHours = Math.max(0, workHours - 9); // After 9 hours (10 AM to 7 PM)

        const { error: updateErr } = await supabase
            .from('shifts')
            .update({
                status: 'completed',
                actual_end: actualEnd.toISOString(),
                overtime_minutes: Math.round(overtimeHours * 60)
            })
            .eq('id', shift.id);

        if (updateErr) throw updateErr;

        // Upsert into attendance table
        const { error: attErr } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                shift_id: shift.id,
                date: todayDate,
                status: 'present',
                total_hours: parseFloat(workHours.toFixed(2)),
                overtime_hours: parseFloat(overtimeHours.toFixed(2))
            }, { onConflict: 'user_id, date' });

        if (attErr) console.error("Attendance Log Error:", attErr.message);
        
        console.log("✅ Successfully Clocked Out and updated Attendance at 7:00 PM IST!");
    }
}

run().catch(err => {
    console.error("Critical Error:", err.message);
    process.exit(1);
});


