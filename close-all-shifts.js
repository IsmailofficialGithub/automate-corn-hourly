
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://lyltstsxwtlfgihdbmux.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

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
