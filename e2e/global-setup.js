const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const envPath = path.join(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
}

async function globalSetup() {
  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase configuration in .env");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const testDocId = "77777777-7777-7777-7777-777777777777";
  const testDocUrl = `http://localhost:3000/editor/${testDocId}`;
  process.env.TEST_DOC_URL = testDocUrl;

  const emails = [
    { email: "test_user_main@example.com", password: "Password123!", role: "owner" },
    { email: "test_user_a@example.com", password: "Password123!", role: "editor" },
    { email: "test_user_b@example.com", password: "Password123!", role: "editor" },
  ];

  console.log("Setting up E2E test users...");
  const userIds = {};

  for (const item of emails) {
    // Find if user already exists
    const { data, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error("Failed to list users:", listError.message);
      process.exit(1);
    }

    const users = data?.users || [];
    let user = users.find((u) => u.email === item.email);
    if (!user) {
      console.log(`Creating user: ${item.email}`);
      const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email: item.email,
        password: item.password,
        email_confirm: true,
      });
      if (createError) {
        console.error(`Failed to create user ${item.email}:`, createError.message);
        process.exit(1);
      }
      user = userData.user;
    }
    userIds[item.email] = user.id;
  }

  console.log(`Setting up test document: ${testDocId}`);

  // Delete existing test doc if any to reset state
  await supabase.from("documents").delete().eq("id", testDocId);

  // Insert test document
  const { error: docError } = await supabase
    .from("documents")
    .insert({
      id: testDocId,
      title: "E2E Test Document",
      owner_id: userIds["test_user_main@example.com"],
    });

  if (docError) {
    console.error("Failed to insert test document:", docError.message);
    process.exit(1);
  }

  // Insert collaborators
  const collaborators = [
    { document_id: testDocId, user_id: userIds["test_user_main@example.com"], role: "owner" },
    { document_id: testDocId, user_id: userIds["test_user_a@example.com"], role: "editor" },
    { document_id: testDocId, user_id: userIds["test_user_b@example.com"], role: "editor" },
  ];

  const { error: collabError } = await supabase
    .from("document_collaborators")
    .insert(collaborators);

  if (collabError) {
    console.error("Failed to insert collaborators:", collabError.message);
    process.exit(1);
  }

  console.log("Database seeded successfully!");
}

module.exports = globalSetup;
