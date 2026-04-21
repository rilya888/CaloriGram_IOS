#!/usr/bin/env node
/**
 * Generate analysis V2 golden corpus and expected outputs.
 *
 * This script creates a small synthetic photo corpus, calls the live analysis
 * endpoint, and rewrites scripts/data/analysis-v2-golden.json with the current
 * expected values.
 */

const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ENV_PATH = path.join(ROOT, '.env_xcode')
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'data', 'analysis-v2-photo-assets')
const DATASET_PATH = path.join(ROOT, 'scripts', 'data', 'analysis-v2-golden.json')
const AUTH_ENV_PATH = path.join(ROOT, 'scripts', 'data', 'analysis-v2-golden-auth.env')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const entries = {}
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const index = trimmed.indexOf('=')
    if (index <= 0) {
      continue
    }
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    entries[key] = value
  }
  return entries
}

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback || ''
  if (!value) {
    throw new Error(`Missing required environment value: ${name}`)
  }
  return value
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function rgb(r, g, b) {
  return { r, g, b }
}

function mix(a, b, t) {
  return rgb(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  )
}

function setPixel(buffer, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width) {
    return
  }
  const offset = (y * width + x) * 3
  if (offset < 0 || offset + 2 >= buffer.length) {
    return
  }
  buffer[offset] = clampByte(color.r)
  buffer[offset + 1] = clampByte(color.g)
  buffer[offset + 2] = clampByte(color.b)
}

function fillRect(buffer, width, height, x, y, w, h, color) {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(width, Math.ceil(x + w))
  const y1 = Math.min(height, Math.ceil(y + h))
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      setPixel(buffer, width, xx, yy, color)
    }
  }
}

function fillCircle(buffer, width, height, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius))
  const maxX = Math.min(width - 1, Math.ceil(cx + radius))
  const minY = Math.max(0, Math.floor(cy - radius))
  const maxY = Math.min(height - 1, Math.ceil(cy + radius))
  const radiusSq = radius * radius

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= radiusSq) {
        setPixel(buffer, width, x, y, color)
      }
    }
  }
}

function fillEllipse(buffer, width, height, cx, cy, rx, ry, color) {
  const minX = Math.max(0, Math.floor(cx - rx))
  const maxX = Math.min(width - 1, Math.ceil(cx + rx))
  const minY = Math.max(0, Math.floor(cy - ry))
  const maxY = Math.min(height - 1, Math.ceil(cy + ry))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      if (nx * nx + ny * ny <= 1) {
        setPixel(buffer, width, x, y, color)
      }
    }
  }
}

function fillTriangle(buffer, width, height, p1, p2, p3, color) {
  const minX = Math.max(0, Math.floor(Math.min(p1.x, p2.x, p3.x)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(p1.x, p2.x, p3.x)))
  const minY = Math.max(0, Math.floor(Math.min(p1.y, p2.y, p3.y)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(p1.y, p2.y, p3.y)))

  function sign(a, b, c) {
    return (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y)
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p = { x, y }
      const d1 = sign(p, p1, p2)
      const d2 = sign(p, p2, p3)
      const d3 = sign(p, p3, p1)
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0
      if (!(hasNeg && hasPos)) {
        setPixel(buffer, width, x, y, color)
      }
    }
  }
}

function drawGradientBackground(buffer, width, height, topColor, bottomColor) {
  for (let y = 0; y < height; y += 1) {
    const t = y / Math.max(1, height - 1)
    const rowColor = mix(topColor, bottomColor, t)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      buffer[offset] = clampByte(rowColor.r)
      buffer[offset + 1] = clampByte(rowColor.g)
      buffer[offset + 2] = clampByte(rowColor.b)
    }
  }
}

function drawPlate(buffer, width, height) {
  fillEllipse(buffer, width, height, width * 0.5, height * 0.58, width * 0.34, height * 0.28, rgb(248, 245, 238))
  fillEllipse(buffer, width, height, width * 0.5, height * 0.58, width * 0.30, height * 0.24, rgb(255, 255, 255))
}

function drawShadow(buffer, width, height) {
  fillEllipse(buffer, width, height, width * 0.5, height * 0.80, width * 0.24, height * 0.05, rgb(200, 175, 140))
}

function drawCommonScene(spec) {
  const width = 800
  const height = 600
  const buffer = Buffer.alloc(width * height * 3)
  drawGradientBackground(buffer, width, height, spec.bgTop, spec.bgBottom)
  fillRect(buffer, width, height, 0, height * 0.72, width, height * 0.28, rgb(183, 149, 113))
  drawShadow(buffer, width, height)
  drawPlate(buffer, width, height)
  return { buffer, width, height }
}

function drawApple(scene) {
  const { buffer, width, height } = scene
  fillCircle(buffer, width, height, 400, 315, 95, rgb(196, 44, 56))
  fillCircle(buffer, width, height, 432, 260, 14, rgb(88, 143, 67))
  fillRect(buffer, width, height, 410, 220, 8, 55, rgb(112, 78, 46))
  fillEllipse(buffer, width, height, 425, 240, 45, 18, rgb(100, 175, 82))
}

function drawBanana(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 404, 320, 175, 55, rgb(238, 205, 68))
  fillEllipse(buffer, width, height, 365, 305, 140, 35, rgb(250, 229, 120))
  fillEllipse(buffer, width, height, 500, 330, 35, 20, rgb(210, 170, 60))
}

function drawOatmeal(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 390, 338, 165, 75, rgb(170, 126, 72))
  fillEllipse(buffer, width, height, 390, 320, 145, 50, rgb(214, 183, 122))
  fillCircle(buffer, width, height, 325, 285, 12, rgb(184, 72, 76))
  fillCircle(buffer, width, height, 425, 290, 10, rgb(140, 88, 160))
  fillCircle(buffer, width, height, 470, 305, 9, rgb(191, 88, 53))
}

function drawEggsBanana(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 325, 320, 55, 72, rgb(252, 241, 220))
  fillCircle(buffer, width, height, 325, 320, 20, rgb(250, 202, 45))
  fillEllipse(buffer, width, height, 430, 330, 155, 48, rgb(239, 203, 67))
  fillEllipse(buffer, width, height, 390, 320, 120, 28, rgb(247, 225, 115))
}

function drawChickenRice(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 330, 330, 145, 68, rgb(203, 161, 104))
  fillEllipse(buffer, width, height, 475, 352, 132, 74, rgb(244, 242, 232))
  fillCircle(buffer, width, height, 458, 343, 6, rgb(220, 218, 210))
  fillCircle(buffer, width, height, 502, 360, 6, rgb(220, 218, 210))
  fillCircle(buffer, width, height, 524, 342, 6, rgb(220, 218, 210))
}

function drawPastaTomato(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 395, 330, 165, 82, rgb(214, 161, 70))
  fillEllipse(buffer, width, height, 400, 320, 150, 52, rgb(240, 196, 88))
  fillCircle(buffer, width, height, 515, 300, 40, rgb(178, 48, 53))
}

function drawSalad(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 390, 330, 170, 76, rgb(69, 154, 89))
  fillCircle(buffer, width, height, 320, 300, 44, rgb(96, 183, 101))
  fillCircle(buffer, width, height, 410, 280, 36, rgb(107, 191, 110))
  fillCircle(buffer, width, height, 475, 330, 30, rgb(242, 99, 86))
  fillCircle(buffer, width, height, 505, 300, 22, rgb(252, 231, 109))
}

function drawYogurtGranola(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 390, 340, 155, 84, rgb(214, 194, 177))
  fillEllipse(buffer, width, height, 392, 322, 132, 56, rgb(246, 246, 242))
  fillCircle(buffer, width, height, 332, 300, 12, rgb(173, 96, 188))
  fillCircle(buffer, width, height, 456, 305, 12, rgb(173, 96, 188))
  fillCircle(buffer, width, height, 425, 275, 14, rgb(190, 133, 67))
}

function drawAvocadoToast(scene) {
  const { buffer, width, height } = scene
  fillRect(buffer, width, height, 275, 280, 230, 135, rgb(194, 134, 72))
  fillEllipse(buffer, width, height, 395, 333, 120, 60, rgb(114, 174, 87))
  fillCircle(buffer, width, height, 355, 310, 20, rgb(144, 199, 112))
  fillCircle(buffer, width, height, 432, 312, 18, rgb(154, 206, 124))
}

function drawBurger(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 400, 270, 165, 62, rgb(220, 173, 77))
  fillRect(buffer, width, height, 255, 310, 290, 48, rgb(84, 60, 42))
  fillRect(buffer, width, height, 275, 355, 250, 24, rgb(68, 149, 67))
  fillEllipse(buffer, width, height, 400, 392, 165, 55, rgb(212, 164, 74))
}

function drawPizza(scene) {
  const { buffer, width, height } = scene
  fillTriangle(
    buffer,
    width,
    height,
    { x: 260, y: 440 },
    { x: 545, y: 290 },
    { x: 555, y: 465 },
    rgb(228, 175, 80)
  )
  fillTriangle(
    buffer,
    width,
    height,
    { x: 295, y: 420 },
    { x: 525, y: 305 },
    { x: 533, y: 440 },
    rgb(245, 206, 108)
  )
  fillCircle(buffer, width, height, 400, 370, 18, rgb(188, 63, 62))
  fillCircle(buffer, width, height, 445, 360, 18, rgb(188, 63, 62))
  fillCircle(buffer, width, height, 470, 410, 16, rgb(188, 63, 62))
}

function drawSalmonPotato(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 350, 330, 155, 62, rgb(232, 132, 108))
  fillCircle(buffer, width, height, 490, 330, 22, rgb(241, 212, 106))
  fillCircle(buffer, width, height, 540, 355, 20, rgb(226, 198, 88))
  fillCircle(buffer, width, height, 455, 360, 18, rgb(248, 221, 126))
}

function drawSoup(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 400, 360, 180, 92, rgb(184, 130, 73))
  fillEllipse(buffer, width, height, 400, 338, 156, 66, rgb(241, 195, 118))
  fillEllipse(buffer, width, height, 400, 322, 142, 46, rgb(247, 214, 151))
  fillCircle(buffer, width, height, 344, 314, 10, rgb(196, 112, 68))
  fillCircle(buffer, width, height, 422, 305, 10, rgb(92, 151, 74))
  fillCircle(buffer, width, height, 495, 322, 11, rgb(198, 83, 73))
  fillRect(buffer, width, height, 515, 255, 8, 62, rgb(210, 210, 206))
  fillRect(buffer, width, height, 520, 250, 12, 10, rgb(230, 230, 224))
  fillRect(buffer, width, height, 310, 240, 8, 60, rgb(214, 214, 210))
  fillRect(buffer, width, height, 295, 235, 12, 10, rgb(230, 230, 224))
}

function drawFries(scene) {
  const { buffer, width, height } = scene
  fillRect(buffer, width, height, 300, 270, 210, 120, rgb(192, 103, 58))
  fillRect(buffer, width, height, 305, 290, 200, 24, rgb(242, 198, 83))
  fillRect(buffer, width, height, 325, 270, 18, 128, rgb(244, 210, 104))
  fillRect(buffer, width, height, 355, 255, 18, 138, rgb(240, 201, 90))
  fillRect(buffer, width, height, 390, 265, 18, 132, rgb(246, 212, 110))
  fillRect(buffer, width, height, 420, 250, 18, 142, rgb(239, 200, 85))
  fillRect(buffer, width, height, 455, 265, 18, 128, rgb(244, 208, 101))
  fillRect(buffer, width, height, 485, 275, 18, 122, rgb(247, 214, 115))
}

function drawRiceVegetables(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 390, 340, 170, 80, rgb(237, 234, 219))
  fillEllipse(buffer, width, height, 318, 300, 35, 25, rgb(112, 179, 93))
  fillEllipse(buffer, width, height, 472, 300, 35, 25, rgb(232, 98, 92))
  fillEllipse(buffer, width, height, 425, 360, 35, 25, rgb(243, 205, 81))
}

function drawPancakes(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 400, 350, 140, 48, rgb(183, 117, 53))
  fillEllipse(buffer, width, height, 400, 315, 130, 42, rgb(198, 127, 61))
  fillEllipse(buffer, width, height, 400, 282, 120, 38, rgb(215, 149, 75))
  fillCircle(buffer, width, height, 318, 250, 18, rgb(189, 63, 95))
  fillCircle(buffer, width, height, 455, 255, 18, rgb(189, 63, 95))
}

function drawSandwich(scene) {
  const { buffer, width, height } = scene
  fillRect(buffer, width, height, 285, 260, 255, 95, rgb(208, 169, 88))
  fillRect(buffer, width, height, 300, 300, 225, 18, rgb(204, 76, 81))
  fillRect(buffer, width, height, 295, 320, 235, 20, rgb(100, 154, 79))
  fillRect(buffer, width, height, 285, 350, 255, 90, rgb(201, 163, 78))
}

function drawSteakBroccoli(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 360, 335, 150, 78, rgb(101, 58, 41))
  fillEllipse(buffer, width, height, 485, 300, 46, 36, rgb(72, 142, 58))
  fillCircle(buffer, width, height, 525, 330, 34, rgb(72, 142, 58))
  fillCircle(buffer, width, height, 470, 352, 30, rgb(72, 142, 58))
}

function drawOmeletteCheese(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 392, 330, 170, 70, rgb(241, 212, 93))
  fillRect(buffer, width, height, 420, 300, 75, 46, rgb(250, 244, 214))
  fillCircle(buffer, width, height, 330, 345, 22, rgb(240, 201, 56))
}

function drawSushi(scene) {
  const { buffer, width, height } = scene
  fillRect(buffer, width, height, 278, 290, 255, 85, rgb(250, 250, 248))
  for (let i = 0; i < 6; i += 1) {
    const cx = 310 + i * 40
    fillCircle(buffer, width, height, cx, 334, 28, rgb(38, 38, 38))
    fillCircle(buffer, width, height, cx, 334, 21, rgb(243, 195, 83))
    fillCircle(buffer, width, height, cx, 334, 11, rgb(247, 142, 126))
  }
}

function drawCerealMilk(scene) {
  const { buffer, width, height } = scene
  fillEllipse(buffer, width, height, 390, 343, 150, 84, rgb(201, 184, 164))
  fillEllipse(buffer, width, height, 390, 320, 130, 58, rgb(249, 249, 247))
  for (const [x, y] of [[330, 300], [370, 292], [420, 308], [456, 287], [478, 320]]) {
    fillCircle(buffer, width, height, x, y, 12, rgb(214, 171, 76))
  }
}

const PHOTO_SCENES = {
  apple: drawApple,
  banana: drawBanana,
  oatmeal: drawOatmeal,
  eggs_banana: drawEggsBanana,
  chicken_rice: drawChickenRice,
  pasta_tomato: drawPastaTomato,
  salad: drawSalad,
  yogurt_granola: drawYogurtGranola,
  avocado_toast: drawAvocadoToast,
  burger: drawBurger,
  pizza: drawPizza,
  salmon_potato: drawSalmonPotato,
  fries: drawFries,
  rice_vegetables: drawRiceVegetables,
  pancakes: drawPancakes,
  sandwich: drawSandwich,
  steak_broccoli: drawSteakBroccoli,
  omelette_cheese: drawOmeletteCheese,
  sushi: drawSushi,
  cereal_milk: drawCerealMilk
}

function writePpm(filePath, buffer, width, height) {
  const header = `P3\n${width} ${height}\n255\n`
  const lines = [header]
  for (let y = 0; y < height; y += 1) {
    const row = []
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      row.push(`${buffer[offset]} ${buffer[offset + 1]} ${buffer[offset + 2]}`)
    }
    lines.push(`${row.join(' ')}\n`)
  }
  fs.writeFileSync(filePath, lines.join(''))
}

function ppmToPng(ppmPath, pngPath) {
  childProcess.execFileSync('sips', ['-s', 'format', 'png', ppmPath, '--out', pngPath], {
    stdio: 'ignore'
  })
}

function buildPhotoSpecs() {
  return [
    { id: 'photo_en_apple_150', locale: 'en', comment: 'apple 150g', key: 'apple', filename: 'photo_en_apple_150.png' },
    { id: 'photo_en_banana_118', locale: 'en', comment: 'banana 118g', key: 'banana', filename: 'photo_en_banana_118.png' },
    { id: 'photo_en_oatmeal_80', locale: 'en', comment: 'oatmeal 80g', key: 'oatmeal', filename: 'photo_en_oatmeal_80.png' },
    { id: 'photo_ru_eggs_banana', locale: 'ru', comment: '2 варёных яйца и банан', key: 'eggs_banana', filename: 'photo_ru_eggs_banana.png' },
    { id: 'photo_en_chicken_rice', locale: 'en', comment: 'chicken breast 180g and cooked white rice 150g', key: 'chicken_rice', filename: 'photo_en_chicken_rice.png' },
    { id: 'photo_ru_pasta_tomato', locale: 'ru', comment: 'паста с томатным соусом', key: 'pasta_tomato', filename: 'photo_ru_pasta_tomato.png' },
    { id: 'photo_it_salad', locale: 'it', comment: 'insalata mista con verdure', key: 'salad', filename: 'photo_it_salad.png' },
    { id: 'photo_en_yogurt_granola', locale: 'en', comment: 'yogurt with granola and berries', key: 'yogurt_granola', filename: 'photo_en_yogurt_granola.png' },
    { id: 'photo_ru_avocado_toast', locale: 'ru', comment: 'тост с авокадо', key: 'avocado_toast', filename: 'photo_ru_avocado_toast.png' },
    { id: 'photo_en_burger', locale: 'en', comment: 'beef burger with lettuce and tomato', key: 'burger', filename: 'photo_en_burger.png' },
    { id: 'photo_it_pizza', locale: 'it', comment: 'pizza margherita slice', key: 'pizza', filename: 'photo_it_pizza.png' },
    { id: 'photo_en_salmon_potato', locale: 'en', comment: 'salmon with roasted potatoes', key: 'salmon_potato', filename: 'photo_en_salmon_potato.png' },
    { id: 'photo_en_fries', locale: 'en', comment: 'french fries', key: 'fries', filename: 'photo_en_fries.png' },
    { id: 'photo_it_rice_vegetables', locale: 'it', comment: 'riso con verdure', key: 'rice_vegetables', filename: 'photo_it_rice_vegetables.png' },
    { id: 'photo_en_pancakes', locale: 'en', comment: 'pancakes with berries', key: 'pancakes', filename: 'photo_en_pancakes.png' },
    { id: 'photo_ru_sandwich', locale: 'ru', comment: 'сэндвич с индейкой', key: 'sandwich', filename: 'photo_ru_sandwich.png' },
    { id: 'photo_it_steak_broccoli', locale: 'it', comment: 'bistecca con broccoli', key: 'steak_broccoli', filename: 'photo_it_steak_broccoli.png' },
    { id: 'photo_en_omelette_cheese', locale: 'en', comment: 'cheese omelette', key: 'omelette_cheese', filename: 'photo_en_omelette_cheese.png' },
    { id: 'photo_ru_sushi', locale: 'ru', comment: 'суши роллы', key: 'sushi', filename: 'photo_ru_sushi.png' },
    { id: 'photo_it_cereal_milk', locale: 'it', comment: 'cereali con latte', key: 'cereal_milk', filename: 'photo_it_cereal_milk.png' }
  ]
}

function buildTextCases() {
  return [
    {
      id: 'en_apple_150',
      input_type: 'text',
      locale: 'en',
      text: 'apple 150g',
      expected: { calories: 78, protein: 0.5, fat: 0.3, carbs: 20.7 }
    },
    {
      id: 'en_banana_118',
      input_type: 'text',
      locale: 'en',
      text: 'banana 118g',
      expected: { calories: 105, protein: 1.3, fat: 0.4, carbs: 26.9 }
    },
    {
      id: 'en_oatmeal_80',
      input_type: 'text',
      locale: 'en',
      text: 'oatmeal 80g',
      expected: { calories: 311, protein: 13.5, fat: 5.5, carbs: 53.0 }
    },
    {
      id: 'ru_eggs_banana',
      input_type: 'text',
      locale: 'ru',
      text: '2 варёных яйца и банан',
      expected: { calories: 248, protein: 13.9, fat: 9.9, carbs: 27.6 }
    },
    {
      id: 'it_eggs_banana',
      input_type: 'text',
      locale: 'it',
      text: '2 uova sode e una banana',
      expected: { calories: 248, protein: 13.9, fat: 9.9, carbs: 27.6 }
    },
    {
      id: 'en_chicken_rice',
      input_type: 'text',
      locale: 'en',
      text: 'chicken breast 180g and cooked white rice 150g',
      expected: { calories: 492, protein: 59.9, fat: 7.0, carbs: 42.3 }
    }
  ]
}

async function ensurePhotoCorpus() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const specs = buildPhotoSpecs()
  for (const spec of specs) {
    const ppmPath = path.join(OUTPUT_DIR, spec.filename.replace(/\.png$/i, '.ppm'))
    const pngPath = path.join(OUTPUT_DIR, spec.filename)
    const renderer = PHOTO_SCENES[spec.key]
    if (!renderer) {
      throw new Error(`Unknown photo scene key: ${spec.key}`)
    }

    const scene = drawCommonScene({
      bgTop: rgb(246, 229, 212),
      bgBottom: rgb(223, 193, 151)
    })
    renderer(scene)
    writePpm(ppmPath, scene.buffer, scene.width, scene.height)
    ppmToPng(ppmPath, pngPath)
    fs.unlinkSync(ppmPath)
  }

  return specs
}

async function createTemporaryUser(supabaseUrl, serviceRoleKey) {
  const email = `golden-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`
  const password = `Golden-${Math.random().toString(36).slice(2)}-${Date.now()}!`

  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to create golden user: ${response.status} ${await response.text()}`)
  }

  return { email, password }
}

async function loginUser(supabaseUrl, anonKey, email, password) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    throw new Error(`Failed to login golden user: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json()
  if (!payload?.access_token) {
    throw new Error('Golden user login did not return access_token')
  }

  return payload.access_token
}

async function callAnalysis(apiBaseUrl, token, payload) {
  const response = await fetch(`${apiBaseUrl}/analysis/v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const json = await response.json()
  if (!response.ok) {
    throw new Error(`Analysis call failed for ${payload.id || payload.text || payload.comment}: ${response.status} ${JSON.stringify(json)}`)
  }

  return json
}

async function buildGoldenDataset() {
  const env = {
    ...loadEnvFile(ENV_PATH),
    ...process.env
  }

  const supabaseUrl = requireEnv('SUPABASE_URL', env.SUPABASE_URL)
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY)
  const anonKey = requireEnv('SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY)
  const apiBaseUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/api`

  const photoSpecs = await ensurePhotoCorpus()
  const { email, password } = await createTemporaryUser(supabaseUrl, serviceRoleKey)
  const token = await loginUser(supabaseUrl, anonKey, email, password)
  fs.writeFileSync(
    AUTH_ENV_PATH,
    `API_BASE_URL=${apiBaseUrl}\nAUTH_EMAIL=${email}\nAUTH_PASSWORD=${password}\nAUTH_TOKEN=${token}\n`
  )

  const dataset = []
  const failures = []
  for (const entry of buildTextCases()) {
    try {
      const response = await callAnalysis(apiBaseUrl, token, {
        input_type: 'text',
        locale: entry.locale,
        text: entry.text
      })

      dataset.push({
        ...entry,
        actual_locale: response.locale,
        expected: {
          calories: response.totals.calories,
          protein: response.totals.protein,
          fat: response.totals.fat,
          carbs: response.totals.carbs
        }
      })
    } catch (error) {
      failures.push({ id: entry.id, error: String(error.message || error) })
    }
  }

  for (const spec of photoSpecs) {
    const imagePath = path.join(OUTPUT_DIR, spec.filename)
    const imageBase64 = fs.readFileSync(imagePath).toString('base64')
    try {
      const response = await callAnalysis(apiBaseUrl, token, {
        input_type: 'photo',
        locale: spec.locale,
        comment: spec.comment,
        image: imageBase64
      })

      dataset.push({
        id: spec.id,
        input_type: 'photo',
        locale: spec.locale,
        comment: spec.comment,
        image_path: path.relative(ROOT, imagePath),
        expected: {
          calories: response.totals.calories,
          protein: response.totals.protein,
          fat: response.totals.fat,
          carbs: response.totals.carbs
        }
      })
    } catch (error) {
      failures.push({ id: spec.id, error: String(error.message || error) })
    }
  }

  if (failures.length) {
    console.log('Some cases failed during corpus generation:')
    for (const failure of failures) {
      console.log(`- ${failure.id}: ${failure.error}`)
    }
  }

  fs.writeFileSync(DATASET_PATH, `${JSON.stringify(dataset, null, 2)}\n`)
  console.log(`Wrote ${dataset.length} golden cases to ${DATASET_PATH}`)
}

buildGoldenDataset().catch((error) => {
  console.error(error)
  process.exit(1)
})
