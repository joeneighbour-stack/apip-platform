// ============================================================================
// One-time user provisioning script — APIP team accounts
// Run: npx tsx src/scripts/provisionUsers.ts
// ============================================================================
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const USERS = [
  // Analysts
  { email: 'iancolie1234@gmail.com',    display_name: 'Ian Coleman',    role: 'ANALYST', analyst_id: '79c48857-91b6-4458-aaf7-61537852b7d0' },
  { email: 'maged_essam89@hotmail.com', display_name: 'Maged Darwish',  role: 'ANALYST', analyst_id: '3eaa9d7f-e4a0-4da8-9ef7-d4fdfd0e9d69' },
  { email: 'monahassan83@hotmail.com',  display_name: 'Mona Hassan',    role: 'ANALYST', analyst_id: 'bacb26e1-b62a-4b31-bf95-db8da5d712d1' },
  { email: 'khaled.gaad@gmail.com',     display_name: 'Khaled Gad',     role: 'ANALYST', analyst_id: 'a1ea262b-b084-414f-bd50-001d740139cb' },
  { email: 'vetradefx@gmail.com',       display_name: 'Tibor Vrbovsky', role: 'ANALYST', analyst_id: 'a3a9e420-ba79-466b-901e-5b921a079509' },
  // Managers
  { email: 'andrew.lane@acuitytrading.com',     display_name: 'Andrew Lane',     role: 'MANAGER', analyst_id: null },
  { email: 'seamus.keaveney@acuitytrading.com', display_name: 'Seamus Keaveney', role: 'MANAGER', analyst_id: null },
  { email: 'giles.hodgson@acuitytrading.com',   display_name: 'Giles Hodgson',   role: 'MANAGER', analyst_id: null },
  { email: 'jeremy.preston@acuitytrading.com',  display_name: 'Jeremy Preston',  role: 'MANAGER', analyst_id: null },
  { email: 'armin.kamara@acuitytrading.com',    display_name: 'Armin Kamara',    role: 'MANAGER', analyst_id: null },
  // Admins
  { email: 'vlad@acuitytrading.com', display_name: 'Vlad', role: 'ADMIN', analyst_id: null },
]

const TEMP_PASSWORD = 'Acuity2026!'

async function main() {
  console.log('=== APIP User Provisioning ===\n')

  // Step 1: Update Ian's existing test account email
  console.log('Updating Ian Coleman test account email...')
  const { data: { users: allUsers } } = await db.auth.admin.listUsers()
  const testUser = allUsers.find(u => u.email === 'test@performance.com')
  if (testUser) {
    const { error } = await db.auth.admin.updateUserById(testUser.id, {
      email: 'iancolie1234@gmail.com',
      email_confirm: true,
    })
    if (error) console.log(`  ❌ ${error.message}`)
    else {
      await db.from('app_users')
        .update({ display_name: 'Ian Coleman', role: 'ANALYST' })
        .eq('analyst_id', '79c48857-91b6-4458-aaf7-61537852b7d0')
      console.log('  ✅ Ian Coleman updated')
    }
  } else {
    console.log('  ⚠️  test@performance.com not found — may already be updated')
  }

  // Step 2: Create remaining accounts
  console.log('\nCreating new accounts...')
  const existingEmails = new Set(allUsers.map(u => u.email))

  for (const user of USERS) {
    // Skip Ian — handled above
    if (user.email === 'iancolie1234@gmail.com') continue

    if (existingEmails.has(user.email)) {
      console.log(`  ⚠️  ${user.display_name} already exists — skipping`)
      continue
    }

    process.stdout.write(`  Creating ${user.display_name} (${user.email})... `)

    const { data: authUser, error: authError } = await db.auth.admin.createUser({
      email: user.email,
      password: TEMP_PASSWORD,
      email_confirm: true,
    })

    if (authError || !authUser.user) {
      console.log(`❌ ${authError?.message}`)
      continue
    }

    const { error: appError } = await db.from('app_users').insert({
      auth_user_id: authUser.user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      analyst_id: user.analyst_id,
    })

    if (appError) console.log(`❌ app_users: ${appError.message}`)
    else console.log('✅')
  }

  console.log('\n=== Done ===')
  console.log(`Temporary password: ${TEMP_PASSWORD}`)
  console.log('All users should change their password on first login.')
}

main().catch(console.error)
