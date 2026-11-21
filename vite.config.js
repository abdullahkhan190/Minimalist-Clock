import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const base = '/'

export default defineConfig({
  base,
  plugins: [react()],
})
