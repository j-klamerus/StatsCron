// my-react-app-backend/server.js
import chromium from '@sparticuz/chromium';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import puppeteer from 'puppeteer-core';
//import puppeteerCore from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
dotenv.config(); // Load environment variables from .env

const playerIDS = [
    ['76561199005990640', 'george'],
     ['76561198134691223', 'kaleb'],
      ['76561198255308115', 'kyle'],
       ['76561198430504075', 'jucc'],
        ['76561198171067849','colton'],
         ['76561198095570402', 'aidan'],
          ['76561198816663208', 'jacob' ]
        ]

puppeteerExtra.use(StealthPlugin());

export const dynamic = 'force-dynamic'; // Crucial for Vercel Cron

let client;
 if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set.');
    }
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db('your_database_name'); // REPLACE with your database name
    // Insert the data into the collection
    for(let i=0; i < playerIDS.length; i++) {
        let collection = db.collection(playerIDS[i][1]); // REPLACE with your collection name
        let stats = await getdata(playerIDS[i][0]);
        if(Array.isArray(stats) && stats.length > 0) {
            await collection.insertMany(stats);
            console.log(`${playerIDS[i][1]} stats inserted successfully.`);
        } else {
            console.log(`No stats found for ${playerIDS[i][1]}.`);
        }
    }

async function getdata(playerID) {
  let browser;
  try {
    const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production';
    console.log(`Running in ${isVercel ? 'Vercel (Production)' : 'Local/Development'} environment.`);
    let puppeteerLaunchConfig = {};

    if (isVercel) {
      // Vercel (or AWS Lambda) environment
      puppeteerLaunchConfig = {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(), // Essential for Vercel
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      };
      console.log('Using @sparticuz/chromium for Vercel deployment.');
    } else {
      puppeteerLaunchConfig = {
        headless: false, // Keep for debugging
        defaultViewport: null,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--start-maximized'],
      };
      console.log('Using local Chromium/Chrome for development.');
    }


    browser = await puppeteer.launch({ ...puppeteerLaunchConfig }); 
  } catch (error) {
    console.error('Error launching browser:', error);
    return [];
  }

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36');

  await page.goto(`https://csstats.gg/player/${playerID}`, {
    waitUntil: 'domcontentloaded', // Initial load
  });

  console.log('Navigated to player page.');

  try {
    const matchesLiSelector = '#matches-nav'; // Selector for the <li> element

    // 1. Wait for the <li> to be present in the DOM and visible
    await page.waitForSelector(matchesLiSelector, { visible: true, timeout: 60000 });
    console.log('Matches LI element found and visible.');

    // 2. Add a slight pause to ensure any JS associated with rendering is done
    await new Promise(r => setTimeout(r, 500));

    // 3. IMPORTANT: Identify and click the *inner* clickable element (likely an <a> or <span>)
    const clicked = await page.evaluate((liSelector) => {
      const liElement = document.querySelector(liSelector);
      if (!liElement) {
        console.error(`LI element with selector ${liSelector} not found.`);
        return false;
      }

      let clickableElement = liElement.querySelector('a');
      if (!clickableElement) {
          clickableElement = liElement.querySelector('span');
      }

      if (clickableElement) {
        clickableElement.click();
        console.log('Direct DOM click executed on inner element of #matches-nav.');
        return true;
      } else {
        console.error(`No clickable child (<a> or <span>) found inside ${liSelector}.`);
        return false;
      }
    }, matchesLiSelector);

    if (!clicked) {
      console.error('Failed to click the matches tab. The inner clickable element was not found or clicked.');
    } else {
      console.log('Successfully attempted click on matches tab via page.evaluate.');

      // 4. Wait for the content associated with the matches tab to load
      await page.waitForSelector('#match-list-outer table tbody tr.p-row', { timeout: 30000 });
      console.log('Matches list content appeared after tab click.');

      // 5. Scrape the data, including multiple columns with descriptive keys
      const data = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#match-list-outer table tbody tr.p-row'));
        const output = [];

        // Define the 0-based HTML indices and their corresponding descriptive names
        // CONFIRM THESE NAMES AND INDICES BY INSPECTING THE WEBPAGE'S TABLE HEADERS!
        const columnMap = {
          0: 'MatchLink', // Likely the first column is a link/ID to the match
          2: 'Map',       // Adjusting for the blank column at index 1
          3: 'Score',
          5: 'Kills',
          6: 'Deaths',
          7: 'Assists',
          9: 'HS%',      // Kill/Death Ratio
          10: 'ADR',     // Average Damage per Round
          19: 'Rating'   // The 20th visual column, which is HTML index 19
        };

        const desiredColumnIndices = Object.keys(columnMap).map(Number); // Get just the indices for iteration

        for (let i = 0; i < Math.min(20, rows.length); i++) { // Scrape up to 20 rows
          const cells = rows[i].querySelectorAll('td');
          const rowData = {}; // Object to store data for the current row

          for (const index of desiredColumnIndices) {
            const keyName = columnMap[index]; // Get the descriptive key name

            if (cells.length <= index) {
              console.warn(`Row ${i + 1} does not have HTML column index ${index} (for ${keyName}). Setting to null.`);
              rowData[keyName] = null;
            } else {
              // Extract text content. For links, you might want to get href as well.
              // For 'MatchLink', if it's an <a>, you might want its href:
              if (keyName === 'MatchLink') {
                 const linkElement = cells[index].querySelector('a');
                 rowData[keyName] = linkElement ? linkElement.href : cells[index].innerText.trim();
              } else {
                 rowData[keyName] = cells[index].innerText.trim();
              }
            }
          }
          output.push(rowData);
        }
        return output;
      });

      console.log('Scraped data:', data);
      return data; // Return the scraped data
    }

  } catch (error) {
    console.error('Error during scraping:', error);
    if (error.name === 'TimeoutError') {
      console.warn('Timeout: Elements did not appear within the expected time. This indicates a problem with the tab, its visibility, or the match list loading.');
    }
  } finally {
    //await new Promise(r => setTimeout(r, 5000)); // Keep open for final inspection
    await browser.close();
  }
};
