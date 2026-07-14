/**
 * Oxford Brookes Course Ingestion Script
 *
 * Scrapes course data from the Oxford Brookes public course search, then
 * creates CoursePage content items in Optimizely SaaS CMS.
 *
 * Usage:
 *   node --env-file=.env ./utils/courses/ingest-courses.mjs
 *
 * Optional env overrides:
 *   COURSE_PARENT_KEY   - CMS key of the parent folder for courses (default: auto-discover)
 *   COURSE_LIMIT        - max courses to ingest (default: 100)
 *   COURSE_DRY_RUN      - set to "true" to scrape only, skip CMS creation
 *   COURSE_LOCALE       - locale to publish under (default: en)
 */

import { createCmsApiClient } from '../cms-api-client.mjs';

const CMS_URL = process.env.OPTIMIZELY_CMS_URL;
const CLIENT_ID = process.env.OPTIMIZELY_CLIENT_ID;
const CLIENT_SECRET = process.env.OPTIMIZELY_CLIENT_SECRET;
// API expects GUID without hyphens
const PARENT_KEY = process.env.COURSE_PARENT_KEY
    ? process.env.COURSE_PARENT_KEY.replace(/-/g, '')
    : null;
const LIMIT = parseInt(process.env.COURSE_LIMIT || '100', 10);
const DRY_RUN = process.env.COURSE_DRY_RUN === 'true';
const LOCALE = process.env.COURSE_LOCALE || 'en';

const BROOKES_BASE = 'https://www.brookes.ac.uk';

const SITEMAP_URL = `${BROOKES_BASE}/sitemap/courses`;

// Study level inferred from the URL path segment
const LEVEL_MAP = {
    undergraduate: 'Undergraduate',
    postgraduate: 'Postgraduate',
    research: 'Research',
    cpd: 'CPD',
};

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml',
    'Accept-Language': 'en-GB,en;q=0.9',
};

// ── Delay helper ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Collect up to `limit` unique course URLs from the XML sitemap ────────────
async function collectCourseUrls(limit) {
    console.log(`  Fetching sitemap: ${SITEMAP_URL}`);
    const res = await fetch(SITEMAP_URL, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`);
    const xml = await res.text();

    const all = [];
    const re = /<loc>(https?:\/\/(?:www\.)?brookes\.ac\.uk\/courses\/(undergraduate|postgraduate|research|cpd)\/([^<]+))<\/loc>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const url = m[1].trim();
        const levelKey = m[2].toLowerCase();
        const studyLevel = LEVEL_MAP[levelKey] || 'Undergraduate';
        if (!all.find(x => x.url === url)) {
            all.push({ url, studyLevel });
        }
    }
    console.log(`  Found ${all.length} courses in sitemap`);
    return all.slice(0, limit);
}

// ── Scrape a single course detail page ───────────────────────────────────────
async function scrapeCourseDetail(url, knownStudyLevel) {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) {
        console.warn(`  Could not fetch ${url}: ${res.status}`);
        return null;
    }
    const html = await res.text();

    const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    // ── JSON-LD: fastest source for title, description, UCAS code ─────────────
    let jsonLd = {};
    try {
        const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (ldMatch) jsonLd = JSON.parse(ldMatch[1]);
    } catch {}

    // Title from JSON-LD name, fallback to <h1>
    const titleRaw = jsonLd.name
        || strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');

    // Qualification: JSON-LD educationalCredentialAwarded or <h1> sub-heading or og:title prefix
    const qualRaw = jsonLd.educationalCredentialAwarded
        || html.match(/<strong[^>]*>UCAS code:<\/strong>[^<]*<\/p>\s*<p[^>]*><strong[^>]*>[\s\S]*?<\/strong>([^<]+)</i)?.[1]?.trim()
        || strip(html.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');

    // Description from JSON-LD or meta description
    const metaDesc = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || '';
    const description = (jsonLd.description || metaDesc).slice(0, 500);

    // UCAS code — <strong>UCAS code:</strong> NL41
    const ucasCode = strip(html.match(/<strong[^>]*>UCAS code:<\/strong>\s*([A-Z0-9]{2,8})/i)?.[1] || '');

    // Duration — <strong>Full time:</strong> 3 years...
    const ftMatch = html.match(/<strong[^>]*>Full time:<\/strong>\s*([^<]+)/i);
    const ptMatch = html.match(/<strong[^>]*>Part time:<\/strong>\s*([^<]+)/i);
    const duration = [
        ftMatch ? `Full time: ${ftMatch[1].trim()}` : '',
        ptMatch ? `Part time: ${ptMatch[1].trim()}` : '',
    ].filter(Boolean).join('; ');

    // Location — <strong>Location:</strong> ... link or text
    const locationBlock = html.match(/<strong[^>]*>Location:<\/strong>([\s\S]*?)<\/p>/i)?.[1] || '';
    const location = strip(locationBlock) || 'Headington';

    // School — <strong>School(s):</strong> ... link
    const schoolBlock = html.match(/<strong[^>]*>School\(s?\):<\/strong>([\s\S]*?)<\/p>/i)?.[1] || '';
    const school = strip(schoolBlock);

    // Mode of study
    const modes = [];
    if (ftMatch || /full.time/i.test(html)) modes.push('Full Time');
    if (ptMatch || /part.time/i.test(html)) modes.push('Part Time');

    // Study level — prefer value from listing page
    let studyLevel = knownStudyLevel || 'Undergraduate';

    // Entry dates — <strong>Start dates:</strong> September 2026
    const startDatesMatch = html.match(/<strong[^>]*>Start dates?:<\/strong>\s*([^<]+)/i);
    const entryDates = startDatesMatch
        ? startDatesMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean)
        : [...new Set([...html.matchAll(/(September|January|February|October)\s+(202\d)/gi)]
            .map(m => `${m[1]} ${m[2]}`))].slice(0, 3);

    // Accreditations
    const accredMatch = html.match(/Accreditation[s]?\s*<\/h[23]>([\s\S]*?)<\/(?:p|div|section)>/i);
    const accreditations = accredMatch
        ? strip(accredMatch[1]).slice(0, 500)
        : '';

    // Route segment from URL (last path segment)
    const slug = url.split('/').filter(Boolean).pop() || '';

    // Course title: combine h1 and qualification
    const title = titleRaw || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const qualification = qualRaw && qualRaw !== title ? qualRaw : '';

    return {
        url,
        slug,
        title: title.slice(0, 200),
        qualification: qualification.slice(0, 100),
        studyLevel,
        modeOfStudy: modes.length ? modes : ['Full Time'],
        entryDates: entryDates.length ? entryDates : ['September 2026'],
        offeredBy: 'Oxford Brookes University',
        location: location.slice(0, 100),
        school: school.slice(0, 200),
        duration: duration.slice(0, 200),
        ucasCode: ucasCode.slice(0, 10),
        description: description.slice(0, 1000),
        accreditations: accreditations.slice(0, 500),
    };
}

// ── CMS content creation ──────────────────────────────────────────────────────
async function createCourseInCms(client, course, parentKey, locale) {
    const displayName = `${course.title}${course.qualification ? ` — ${course.qualification}` : ''}`.slice(0, 255);
    const body = {
        contentType: 'CoursePage',
        container: parentKey,
        initialVersion: {
            displayName,
            locale,
            routeSegment: course.slug,
            properties: {
                Title: { value: course.title },
                Qualification: { value: course.qualification || null },
                StudyLevel: { value: course.studyLevel },
                ModeOfStudy: { value: course.modeOfStudy },
                EntryDates: { value: course.entryDates },
                OfferedBy: { value: course.offeredBy },
                Location: { value: course.location || null },
                School: { value: course.school || null },
                Duration: { value: course.duration || null },
                UcasCode: { value: course.ucasCode || null },
                Description: { value: course.description ? { html: `<p>${course.description}</p>` } : null },
                Accreditations: { value: course.accreditations || null },
                ExternalUrl: { value: course.url },
            },
        },
    };

    return client._createContent(body);
}

// ── Extend client with content creation ──────────────────────────────────────
function extendClientWithContentApi(client, cmsUrl, clientId, clientSecret) {
    const AUTH_URL = 'https://api.cms.optimizely.com/oauth/token';
    let cachedToken = null;
    let tokenExpiry = 0;

    async function getToken() {
        if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
        const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const r = await fetch(AUTH_URL, {
            method: 'POST',
            headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials',
        });
        const data = await r.json();
        if (data.error) throw new Error(`Auth error: ${data.error_description}`);
        cachedToken = data.access_token;
        tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        return cachedToken;
    }

    // The SaaS CMS content management endpoint (always the central API gateway)
    const contentApiBase = 'https://api.cms.optimizely.com/v1';

    client._createContent = async function (body) {
        const token = await getToken();
        const res = await fetch(`${contentApiBase}/content`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Content create failed: ${res.status} — ${err}`);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };

    return client;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log(' Oxford Brookes Course Ingestion');
    console.log(`  Limit:    ${LIMIT} courses`);
    console.log(`  Dry run:  ${DRY_RUN}`);
    console.log(`  Locale:   ${LOCALE}`);
    console.log(`  CMS URL:  ${CMS_URL || '(from API gateway)'}`);
    console.log('═══════════════════════════════════════════════\n');

    // Step 1: Collect course URLs
    console.log(`[1/3] Collecting up to ${LIMIT} course URLs from Oxford Brookes...`);
    const courseUrls = await collectCourseUrls(LIMIT);
    console.log(`      Found ${courseUrls.length} unique course URLs.\n`);

    // Step 2: Scrape each course
    console.log('[2/3] Scraping course details...');
    const courses = [];
    for (let i = 0; i < courseUrls.length; i++) {
        const { url, studyLevel: knownStudyLevel } = typeof courseUrls[i] === 'string'
            ? { url: courseUrls[i], studyLevel: undefined }
            : courseUrls[i];
        process.stdout.write(`  [${i + 1}/${courseUrls.length}] ${url.split('/').pop()}... `);
        try {
            const course = await scrapeCourseDetail(url, knownStudyLevel);
            if (course) {
                courses.push(course);
                process.stdout.write('✓\n');
            } else {
                process.stdout.write('skip\n');
            }
        } catch (err) {
            process.stdout.write(`err: ${err.message}\n`);
        }
        await sleep(250);
    }
    console.log(`\n      Scraped ${courses.length} courses.\n`);

    if (DRY_RUN) {
        console.log('[3/3] Dry run — skipping CMS creation.');
        console.log('\nSample scraped data:');
        console.log(JSON.stringify(courses[0], null, 2));
        return;
    }

    // Step 3: Create content in CMS
    if (!CLIENT_ID || !CLIENT_SECRET) {
        console.error('ERROR: OPTIMIZELY_CLIENT_ID and OPTIMIZELY_CLIENT_SECRET are required.');
        console.error('Set them in your .env file and re-run.');
        process.exit(1);
    }

    console.log('[3/3] Creating CoursePage content items in Optimizely CMS...');
    let baseClient = createCmsApiClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    let client = extendClientWithContentApi(baseClient, CMS_URL, CLIENT_ID, CLIENT_SECRET);

    let created = 0;
    let failed = 0;
    for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        process.stdout.write(`  [${i + 1}/${courses.length}] ${course.title.slice(0, 60)}... `);
        try {
            await createCourseInCms(client, course, PARENT_KEY, LOCALE);
            process.stdout.write('✓\n');
            created++;
        } catch (err) {
            const msg = err.message;
            if (msg.includes('already in use')) {
                process.stdout.write('skip (already exists)\n');
            } else {
                process.stdout.write(`FAIL: ${msg.slice(0, 100)}\n`);
                failed++;
            }
        }
        // Avoid rate limiting
        await sleep(150);
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log(` Done. Created: ${created}  Failed: ${failed}`);
    console.log('═══════════════════════════════════════════════');
    if (failed > 0) {
        console.log('\nNote: failures are often due to:');
        console.log('  - Duplicate slugs (course already exists)');
        console.log('  - Content type not yet pushed to CMS (run: yarn type:push CoursePage)');
        console.log('  - API endpoint mismatch (set OPTIMIZELY_CMS_URL correctly)');
    }
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
