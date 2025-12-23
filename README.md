# Creative Video Editing Tool

A browser-based video editing application built with React and Shotstack Studio SDK.

## Features

- **Timeline Editing** - Drag and drop clips on a multi-track timeline
- **Media Import** - Import local video, audio, and image files
- **Clip Management** - Undo, redo, and delete
- **Export** - Render videos using Shotstack's cloud rendering API

## Prerequisites

- Node.js 16+
- Shotstack API key ([Get one here](https://shotstack.io))

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd creative-video-editing-tool
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```
   VITE_SHOTSTACK_API_KEY=your_api_key_here
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## Usage

### Adding Media
- Drag and drop media files onto the timeline
- Supported formats: MP4, WebM, MOV, MP3, WAV, JPG, PNG, GIF

### Editing
- Click on a clip to select it
- Press `Delete` key or click the delete button to remove selected clip
- Use `Ctrl+Z` to undo delete operations
- Use `Ctrl+Y` to redo

### Exporting
- Click the "Export" button to render your video
- Local files are automatically uploaded to Shotstack servers
- The rendered video URL will be provided when complete

## Tech Stack

- **React** - UI framework
- **Vite** - Build tool
- **Shotstack Studio SDK** - Video editing components
- **Shotstack API** - Cloud video rendering

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_SHOTSTACK_API_KEY` | Your Shotstack API key |

## License

MIT
