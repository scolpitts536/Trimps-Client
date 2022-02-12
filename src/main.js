'use strict';

/* eslint-disable no-console */

const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const url = require('url');
const DiscordRPC = require('discord-rpc');
const https = require('https');
const fs = require('fs');
const Zip = require('adm-zip');
const electron = require('electron');

const dataDir =  (electron.app || electron.remote.app).getPath('userData');

console.info('Data directory:', dataDir);

let checkForUpdatesInterval;
let newVersion = '0.0.0';
let currentVersion = '0.0.0';
let windowClosed = false;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    titleBarStyle: 'default',
    icon: __dirname + '/icon.png',
    minWidth: 300,
    minHeight: 200,
    webPreferences: {
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      fs.readFileSync(`${__dirname}/discord.js`).toString()
    ).catch(e=>{});
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setTitle('Trimps');

  // Check if we've already downloaded the data, otherwise load our loading screen
  if (fs.existsSync(`${dataDir}/pokeclicker-master/docs/index.html`)) {
    mainWindow.loadURL(`file://${dataDir}/Trimps-master/docs/index.html`);
  } else {
    mainWindow.loadURL(`file://${__dirname}/Trimps-master/docs/index.html`);
  }

  mainWindow.on('close', (event) => {
    windowClosed = true
  })
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('page-title-updated', function(e) {
    e.preventDefault()
  });
}

function createSecondaryWindow() {
  let newWindow = new BrowserWindow({
    titleBarStyle: 'default',
    icon: __dirname + '/icon.png',
    minWidth: 300,
    minHeight: 200,
    webPreferences: {
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  newWindow.setMenuBarVisibility(false);
  newWindow.setTitle('Trimps');

  // Check if we've already downloaded the data, otherwise load our loading screen
  if (fs.existsSync(`${dataDir}/Trimps-master/docs/index.html`)) {
    newWindow.loadURL(`file://${dataDir}/Trimps-master/docs/index.html`);
  } else {
    newWindow.loadURL(`file://${__dirname}/Trimps-master/docs/index.html`);
  }

  newWindow.on('close', (event) => {
    newWindow = true
  })
  newWindow.on('closed', () => {
    newWindow = null;
  });
  newWindow.on('page-title-updated', function(e) {
    e.preventDefault()
  });
  return newWindow;
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});


  /*
  UPDATE STUFF
  */
  const isNewerVersion = (version) => {
    return version.localeCompare(currentVersion, undefined, { numeric: true }) === 1;
  }

  const downloadUpdate = async (initial = false) => {
    const zipFilePath = `${dataDir}/update.zip`;
    const file = fs.createWriteStream(zipFilePath);
    https.get('https://codeload.github.com/Trimps/Trimps.github.io/zip/master', async res => {
      let cur = 0;
      try {
        if (!initial) await mainWindow.webContents.executeJavaScript(`Notifier.notify({ title: '[UPDATER] v${newVersion}', message: 'Downloading Files...<br/>Please Wait...', timeout: 1e6 })`);
      }catch(e){}

      res.on('data', async chunk => {
          cur += chunk.length;
          try {
            if (initial) await mainWindow.webContents.executeJavaScript(`setStatus("Downloading Files...<br/>${(cur / 1048576).toFixed(2)} mb")`);
          }catch(e){}
      });

      res.pipe(file).on('finish', async () => {
        try {
          if (initial) await mainWindow.webContents.executeJavaScript('setStatus("Files Downloaded!<br/>Extracting Files...")');
          else await mainWindow.webContents.executeJavaScript(`Notifier.notify({ title: '[UPDATER] v${newVersion}', message: 'Files Downloaded!<br/>Extracting Files...', timeout: 2e4 })`);
        }catch(e){}

        const zip = new Zip(zipFilePath);

        const extracted = zip.extractEntryTo('Trimps-master/docs/', `${dataDir}`, true, true);

        fs.unlinkSync(zipFilePath);

        if (!extracted) {
          return downloadUpdateFailed();
        }

        currentVersion = newVersion;
        startUpdateCheckInterval();

        // If this is the initial download, don't ask the user about refreshing the page
        if (initial) {
          mainWindow.loadURL(`file://${dataDir}/Trimps-master/docs/index.html`);
          return;
        }

        const userResponse = dialog.showMessageBoxSync(mainWindow, {
          title: 'Trimp - Update success!',
          message: `Successfully updated,\nwould you like to reload the page now?`,
          icon: `${__dirname}/icon.png`,
          buttons: ['Yes', 'No'],
          noLink: true,
        });

        if (userResponse == 0){
          mainWindow.loadURL(`file://${dataDir}/Trimps-master/docs/index.html`);
        }
      });
    }).on('error', (e) => {
      return downloadUpdateFailed();
    });
  }

  const downloadUpdateFailed = () => {
    // If client exe updating, return
    if (windowClosed) return;

    const userResponse = dialog.showMessageBoxSync(mainWindow, {
      type: 'error',
      title: 'Trimps - Update failed!',
      message: `Failed to download or extract the update,\nWould you like to retry?`,
      icon: `${__dirname}/icon.png`,
      buttons: ['Yes', 'No'],
      noLink: true,
    });

    if (userResponse == 0) {
      downloadUpdate();
    }
  }

  const checkForUpdates = () => {
    const request = https.get('https://raw.githubusercontent.com/Trimps/Trimps.github.io/master/package.json', res => {
      let body = '';

      res.on('data', d => {
        body += d;
      });

      res.on('end', () => {
        let data = {version:'0.0.0'};
        try {
          data = JSON.parse(body);
          newVersion = data.version;
          const newVersionAvailable = isNewerVersion(data.version);

          if (newVersionAvailable) {
            // Stop checking for updates
            clearInterval(checkForUpdatesInterval);
            // Check if user want's to update now
            shouldUpdateNowCheck();
          }
        }catch(e) {}
      });
    
    }).on('error', (e) => {
      // TODO: Update download failed
      console.warn('Couldn\'t check for updated version, might be offline..');
    });
  }

  const shouldUpdateNowCheck = () => {
    const userResponse = dialog.showMessageBoxSync(mainWindow, {
      title: 'Trimps - Update available!',
      message: `There is a new update available (v${newVersion}),\nWould you like to download it now?\n\n`,
      icon: `${__dirname}/icon.png`,
      buttons: ['Update Now', 'Remind Me', 'No (disable check)'],
      noLink: true,
    });
    
    switch (userResponse) {
      case 0:
        downloadUpdate();
        break;
      case 1:
        // Check again in 1 hour
        setTimeout(shouldUpdateNowCheck, 36e5)
        break;
      case 2:
        console.info('Update check disabled, stop checking for updates');
        break;
    }
  }

  const startUpdateCheckInterval = (run_now = false) => {
    // Check for updates every hour
    checkForUpdatesInterval = setInterval(checkForUpdates, 36e5)
    if (run_now) checkForUpdates();
  }


  try {
    // If we can get our current version, start checking for updates once the game starts
    currentVersion = JSON.parse(fs.readFileSync(`${dataDir}/Trimps-master/docs/package.json`).toString()).version;
    if (currentVersion == '0.0.0') throw Error('Must re-download updated version');
    setTimeout(() => {
      startUpdateCheckInterval(true);
    }, 1e4)
  } catch (e) {
    // Game not downloaded yet
    downloadUpdate(true);
    console.log('downloading...');
  }

  try {
    autoUpdater.on('update-downloaded', () => {
      const userResponse = dialog.showMessageBoxSync(mainWindow, {
        title: 'Trimps - Client Update Available!',
        message: `There is a new client update available,\nWould you like to install it now?\n\n`,
        icon: `${__dirname}/icon.png`,
        buttons: ['Restart App Now', 'Later'],
        noLink: true,
      });
      
      switch (userResponse) {
        case 0:
          windowClosed = true;
          autoUpdater.quitAndInstall(true, true);
          break;
      }
    });
    autoUpdater.checkForUpdatesAndNotify()
  } catch (e) {}
}