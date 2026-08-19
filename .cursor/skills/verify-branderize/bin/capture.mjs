#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const usage = () => {
  process.stderr.write(
    'Usage: node bin/capture.mjs --url <url> --out <dir> [--expect-heading <text>]... [--click-role <role> --click-name <name>]\n'
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const options = {
  clickName: undefined,
  clickRole: 'link',
  expectHeadings: [],
  out: undefined,
  url: undefined,
}

for (let index = 0; index < args.length; index += 1) {
  const flag = args[index]
  const value = args[index + 1]
  if (value === undefined) {
    usage()
  }

  if (flag === '--url') {
    options.url = value
  } else if (flag === '--out') {
    options.out = value
  } else if (flag === '--expect-heading') {
    options.expectHeadings.push(value)
  } else if (flag === '--click-role') {
    options.clickRole = value
  } else if (flag === '--click-name') {
    options.clickName = value
  } else {
    usage()
  }
  index += 1
}

if (options.url === undefined || options.out === undefined) {
  usage()
}

mkdirSync(options.out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  reducedMotion: 'reduce',
  viewport: { height: 900, width: 1280 },
})

try {
  await page.goto(options.url, { waitUntil: 'domcontentloaded' })

  await Promise.all(
    options.expectHeadings.map((heading) =>
      page.getByRole('heading', { name: heading }).first().waitFor()
    )
  )

  if (options.clickName !== undefined) {
    await page.getByRole(options.clickRole, { name: options.clickName }).click()
    await page.waitForLoadState('domcontentloaded')
  }

  const title = await page.title()
  const aria = await page.locator('main').ariaSnapshot()
  const screenshotPath = resolve(options.out, 'page.png')
  await page.screenshot({ fullPage: true, path: screenshotPath })

  writeFileSync(resolve(options.out, 'title.txt'), `${title}\n`)
  writeFileSync(resolve(options.out, 'aria.txt'), `${aria}\n`)
  writeFileSync(
    resolve(options.out, 'notes.md'),
    [
      '# Capture',
      '',
      `- url: ${page.url()}`,
      `- title: ${title}`,
      `- expect-heading: ${options.expectHeadings.join(' | ') || '(none)'}`,
      options.clickName === undefined
        ? '- click: (none)'
        : `- click: ${options.clickRole} "${options.clickName}"`,
      `- screenshot: ${screenshotPath}`,
      '',
    ].join('\n')
  )

  process.stdout.write(
    `${JSON.stringify({ ariaPath: resolve(options.out, 'aria.txt'), screenshotPath, title, url: page.url() }, null, 2)}\n`
  )
} finally {
  await browser.close()
}
