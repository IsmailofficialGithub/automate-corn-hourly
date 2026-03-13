
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://lyltstsxwtlfgihdbmux.supabase.co";
// Using the key from .env if possible, otherwise I'll need to ask or find it.
// The .env had VITE_SUPABASE_PUBLISHABLE_KEY.
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5bHRzdHN4d3RsZmdpaGRibXV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwNjI1MjgsImV4cCI6MjA4NjYzODUyOH0.kaw8n8BoeSQH2Os0PvEJRWO2rMd8M90YSVkpfVx0Rp0";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const users = [
    { email: "ali.ameen@pixoranest.com", password: "Ali.ameen@pixoranest01" },
    { email: "Ismail@pixoranest.com", password: "Ismail@pixoranest01" }
];

async function closeActiveShifts() {
    for (const user of users) {
        console.log(`\nProcessing user: ${user.email}`);
        
        const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: user.password
        });

        if (authErr) {
            console.error(`Auth error for ${user.email}:`, authErr.message);
            continue;
        }

        const userId = auth.user.id;
        console.log(`Logged in. User ID: ${userId}`);

        // Find ANY shift for this user that is blocking (actual_end is NULL and actual_start is NOT NULL)
        const { data: activeShifts, error: fetchErr } = await supabase
            .from('shifts')
            .select('id, date, status, actual_start, actual_end')
            .eq('user_id', userId)
            .is('actual_end', null)
            .not('actual_start', 'is', null);

        if (fetchErr) {
            console.error(`Fetch error for ${user.email}:`, fetchErr.message);
            continue;
        }

        console.log("Blocking shifts found (actual_end IS NULL):", activeShifts);

        if (!activeShifts || activeShifts.length === 0) {
            console.log("No active shifts found for this user.");
            continue;
        }

        console.log(`Found ${activeShifts.length} active shift(s). Closing them...`);

        for (const shift of activeShifts) {
            const { error: updateErr } = await supabase
                .from('shifts')
                .update({ 
                    status: 'completed',
                    actual_end: new Date().toISOString() // IMPORTANT: must not be NULL
                })
                .eq('id', shift.id);

            if (updateErr) {
                console.error(`Failed to close shift ${shift.id}:`, updateErr.message);
            } else {
                console.log(`✅ Closed shift ${shift.id} from ${shift.date}`);
            }
        }
    }
}

closeActiveShifts().catch(console.error);
