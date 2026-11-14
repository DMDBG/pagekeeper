# Pagekeeper

An ad-free reader for EPUB, PDF and TXT books, with audiobooks that play while you read.
Your page and listening spot sync between your iPhone and your PC. Everything also works offline,
then catches up when you're back online.

- **iPhone:** a real app (an `.ipa`) that you sideload. The reader is built into the app, so it opens with no signal.
- **PC:** the same app as a website on GitHub Pages. In Chrome or Edge you can install it, and it works offline too.
- **Sync:** your own free Supabase project. Only you can read your library.

You set this up once, in about 30 minutes. You don't need a Mac.

---

## 1. Create your sync account (Supabase, free)

1. Go to <https://supabase.com>, sign up, and click **New project**. Pick any name and a database password (you won't need the password again $jtkemper06!), then wait about a minute for it to start.
2. Open **SQL Editor** → **New query**. Paste everything from [`supabase/setup.sql`](supabase/setup.sql) and click **Run**. You should see "Success".
3. Open **Authentication** → **Sign In / Providers** → **Email** and turn **Confirm email** off. Then you can sign in right after creating your account. If you leave it on, you'll need to tap a link in an email first.
4. Copy two values into [`web/config.js`](web/config.js):
   - **Project URL**: **Project Settings** → **Data API**. It looks like `https://abcd1234.supabase.co`.
   - **Publishable key**: **Project Settings** → **API Keys**. It starts with `sb_publishable_`. Older projects show a legacy "anon public" key starting with `eyJ` instead; that works too.

   ```js
   window.PK_CONFIG = {
     supabaseUrl: "https://abcd1234.supabase.co",
     supabaseAnonKey: "sb_publishable_..."
   };
   ```

   The publishable key is safe to make public: `setup.sql` locks every row and file to the account that owns it.
   **Never** put the secret key (`sb_secret_...`) in the app; it bypasses all of those locks.

## 2. Put the project on GitHub (free)

1. Create a GitHub account if you don't have one, then click **New repository**. Name it `pagekeeper` and make it **Public**. Free GitHub Pages needs a public repo, but your books are never in the repo; they live in your Supabase account.
2. Upload this whole folder to the repo. The easiest way is [GitHub Desktop](https://desktop.github.com): **File → Add local repository**, then **Publish**. Make sure the hidden `.github` folder is included; it holds the build instructions.
3. In the repo, open **Settings** → **Pages** and set **Source** to **GitHub Actions**.

Every time you push, GitHub builds two things on its own:

| Workflow | What you get |
|---|---|
| **Build iPhone app (IPA)** | `Pagekeeper.ipa`, under **Actions** → latest run → **Artifacts** → `Pagekeeper-ipa` (a zip with the IPA inside) |
| **Publish PC version** | Your PC app at `https://YOUR-USERNAME.github.io/pagekeeper/` |

If the IPA build fails, open the run and look at the red step; the last 40 lines of the build log are printed there.

## 3. Install on your iPhone (Sideloadly, on Windows)

1. Install [Sideloadly](https://sideloadly.io). It also needs **iTunes** and **iCloud** from Apple's website (not the Microsoft Store versions).
2. Unzip `Pagekeeper-ipa.zip` to get `Pagekeeper.ipa`.
3. Plug your iPhone into the PC with a cable and tap **Trust** on the phone.
4. Drag `Pagekeeper.ipa` into Sideloadly, enter your Apple ID, and click **Start**. Sideloadly is a third-party tool, so you may prefer a spare Apple ID.
5. On the iPhone:
   - **Settings → Privacy & Security → Developer Mode** → on, then restart the phone (iOS 16 and later).
   - **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**.
6. Open Pagekeeper, go to **Settings**, tap **Create account** (first time) or **Sign in**.

**The 7-day rule:** with a free Apple ID, Apple makes sideloaded apps stop opening after 7 days. Plug in and click Start in Sideloadly again (or turn on its auto-refresh) to renew. Your books and progress are kept when you re-sign.

## 4. Use it on your PC

Open `https://YOUR-USERNAME.github.io/pagekeeper/`, go to **Settings**, and sign in with the same email and password.
In Chrome or Edge, click the install icon in the address bar to get a desktop app that also opens offline.

**After both devices are signed in:** in Supabase open **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can make an account in your project.

---

## How it works

- **Same page everywhere.** EPUB and TXT books are split into pages of 1,500 characters, so page 10 is page 10 on every screen at any text size. PDFs use their printed pages.
- **Offline first.** Books, audio and progress are saved on the device. Changes wait in a queue and upload when there's a connection.
- **Sync rules.** Your reading spot, listening spot and the book details each keep their own timestamp, so the newest change to each wins and they never overwrite each other. If you're reading a book and another device gets further, you're asked before jumping.
- **Files.** Books and audio files up to 50 MB are copied to your account. Bigger files stay on the device where you added them. Pagekeeper fingerprints them, stores where you downloaded them, and on your other devices offers a download button plus a check that the file you pick is the exact same one.
- **Offline audio.** Audio from your account downloads when you first play it. Tap **Download for offline** in the player to fetch every part before a trip.
- **Read aloud** uses the device's own voice and works offline.

## Limits of the free plans

- Supabase free: 1 GB of file storage and 50 MB per file. Text-only EPUBs are tiny; audiobooks fill it fastest.
- Supabase pauses free projects after 7 days with no use. Opening Pagekeeper on any device counts as use. If yours pauses, click **Restore** in the Supabase dashboard; nothing is lost.
- Kindle formats (MOBI, AZW3) and DRM-protected books can't be opened. [Calibre](https://calibre-ebook.com) converts DRM-free files to EPUB.

## Project layout

```
web/                 the app (HTML/JS), used by both the iPhone app and the PC website
  config.js          your Supabase URL and anon key
ios/                 the iPhone shell: loads web/ from inside the app, keeps audio playing in the background
  project.yml        XcodeGen spec; the GitHub build turns it into an Xcode project
supabase/setup.sql   database table, storage bucket and privacy rules
scripts/             fetches the PDF/EPUB libraries and draws the app icon
.github/workflows/   builds the IPA and publishes the PC version
```

To try the web app on your PC before pushing: run `bash scripts/prepare-web.sh`, then serve the `web` folder
(for example `npx serve web`) and open the address it prints.
