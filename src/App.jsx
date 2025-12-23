import { useEffect, useRef, useState } from 'react';
import { Edit, Canvas, Controls, Timeline } from '@shotstack/shotstack-studio';
import './App.css';

function App() {
  const editRef = useRef(null);
  const canvasRef = useRef(null);
  const timelineRef = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [selectedClip, setSelectedClip] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const previewVideoRef = useRef(null);

  useEffect(() => {
    async function initVideoEditor() {
      try {
        // 1. Retrieve an edit from a template
        const templateUrl =
          "https://shotstack-assets.s3.amazonaws.com/templates/hello-world/hello.json";
        const response = await fetch(templateUrl);
        const template = await response.json();

        // 2. Initialize the edit with dimensions and background color
        const edit = new Edit(template.output.size, template.timeline.background);
        await edit.load();
        
        // Store edit reference for undo/redo
        editRef.current = edit;

        // 3. Set up event listeners
        edit.events.on("clip:selected", (data) => {
          console.log("Clip selected:", data.clip);
          console.log("Track index:", data.trackIndex);
          console.log("Clip index:", data.clipIndex);
          setSelectedClip(data);
        });

        edit.events.on("clip:updated", (data) => {
          console.log("Clip updated!");
          console.log("Previous state:", data.previous);
          console.log("Current state:", data.current);
        });

        // 4. Create a canvas to display the edit
        // Get the monitor wrapper dimensions
        const monitorWrapper = document.querySelector('.monitor-panel:nth-child(2) .monitor-wrapper');
        const wrapperRect = monitorWrapper ? monitorWrapper.getBoundingClientRect() : null;
        
        // Calculate canvas size based on monitor wrapper (with padding consideration)
        const canvasSize = wrapperRect ? {
          width: Math.min(template.output.size.width, wrapperRect.width - 30), // 30px for padding
          height: Math.min(template.output.size.height, wrapperRect.height - 30)
        } : template.output.size;
        
        const canvas = new Canvas(canvasSize, edit);
        await canvas.load();
        canvasRef.current = canvas;
        
        canvas.centerEdit();
        canvas.zoomToFit();

        // 5. Load the template
        await edit.loadEdit(template);
        setDuration(edit.totalDuration);

        // 6. Add keyboard controls
        const controls = new Controls(edit);
        await controls.load();

        // 7. Create timeline with improved dragging
        const timeline = new Timeline(
          edit,
          { width: template.output.size.width, height: 300 }
        );
        await timeline.load();
        timelineRef.current = timeline;

        // 8. Setup playback tracking
        edit.events.on("playback:progress", (data) => {
          setCurrentTime(data.currentTime);
        });

        edit.events.on("playback:play", () => {
          setIsPlaying(true);
        });

        edit.events.on("playback:pause", () => {
          setIsPlaying(false);
        });

        edit.events.on("playback:stop", () => {
          setIsPlaying(false);
          setCurrentTime(0);
        });

        // 9. Fix timeline dragging
        setTimeout(() => {
          const timelineEl = document.querySelector('[data-shotstack-timeline]');
          if (timelineEl) {
            timelineEl.style.cursor = 'default';
            timelineEl.addEventListener('mousedown', (e) => {
              e.stopPropagation();
            }, { capture: true });
          }
        }, 500);

        console.log("Video editor initialized successfully!");
      } catch (error) {
        console.error("Error initializing video editor:", error);
      }
    }

    initVideoEditor();
  }, []);

  const handleUndo = async () => {
    if (editRef.current) {
      try {
        // First check our custom undo stack
        if (undoStack.current.length > 0) {
          const action = undoStack.current.pop();
          
          if (action.type === 'deleteClip') {
            // Restore the deleted clip
            await editRef.current.addClip(action.trackIndex, action.clipData);
            
            // Add to redo stack
            redoStack.current.push(action);
            
            // Get current edit and reload to force complete visual refresh
            const currentEdit = editRef.current.getEdit();
            await editRef.current.loadEdit(currentEdit);
            
            setDuration(editRef.current.totalDuration);
            console.log("Undo delete performed successfully");
            return;
          }
        }
        
        // Try SDK's built-in undo
        const result = editRef.current.undo();
        if (result) {
          console.log("Undo performed successfully");
          
          // Refresh timeline visual after undo
          if (timelineRef.current) {
            await timelineRef.current.rebuildFromEdit();
            timelineRef.current.draw();
          }
          
          // Update duration state
          setDuration(editRef.current.totalDuration);
        } else {
          console.log("Nothing to undo");
        }
      } catch (error) {
        console.error("Undo error:", error);
      }
    }
  };

  const handleRedo = async () => {
    if (editRef.current) {
      try {
        // First check our custom redo stack
        if (redoStack.current.length > 0) {
          const action = redoStack.current.pop();
          
          if (action.type === 'deleteClip') {
            // Find the clip index (it may have been added at a different index after undo)
            const editData = editRef.current.getEdit();
            const track = editData.timeline.tracks[action.trackIndex];
            
            if (track && track.clips) {
              // Find the clip by matching its properties
              let clipIndexToDelete = -1;
              for (let i = 0; i < track.clips.length; i++) {
                const clip = track.clips[i];
                if (clip.start === action.clipData.start && 
                    clip.length === action.clipData.length) {
                  clipIndexToDelete = i;
                  break;
                }
              }
              
              if (clipIndexToDelete >= 0) {
                // Re-delete the clip
                await editRef.current.deleteClip(action.trackIndex, clipIndexToDelete);
                
                // Update action with new clip index for future operations
                action.clipIndex = clipIndexToDelete;
                
                // Add back to undo stack
                undoStack.current.push(action);
                
                // Sync visuals
                await syncTimelineVisuals();
                
                setDuration(editRef.current.totalDuration);
                console.log("Redo delete performed successfully");
                return;
              }
            }
            
            console.log("Could not find clip to redo delete");
            return;
          }
        }
        
        // Try SDK's built-in redo
        const result = editRef.current.redo();
        if (result) {
          console.log("Redo performed successfully");
          
          // Refresh timeline visual after redo
          if (timelineRef.current) {
            await timelineRef.current.rebuildFromEdit();
            timelineRef.current.draw();
          }
          
          // Update duration state
          setDuration(editRef.current.totalDuration);
        } else {
          console.log("Nothing to redo");
        }
      } catch (error) {
        console.error("Redo error:", error);
      }
    }
  };

  const handleDeleteClip = async () => {
    if (!editRef.current || !selectedClip) {
      console.log('No clip selected to delete');
      return;
    }

    try {
      const { trackIndex, clipIndex, clip } = selectedClip;
      
      // Store clip data for undo BEFORE deleting
      const clipData = editRef.current.getClip(trackIndex, clipIndex);
      
      // Clear the selection state FIRST to prevent double-delete
      setSelectedClip(null);
      
      // Clear selection in the SDK
      editRef.current.clearSelection();
      
      // Delete the clip
      await editRef.current.deleteClip(trackIndex, clipIndex);
      
      // Store in undo stack for custom undo
      undoStack.current.push({
        type: 'deleteClip',
        trackIndex,
        clipIndex,
        clipData: clipData || clip // Use clipData from getClip or fall back to selectedClip data
      });
      
      // Clear redo stack when new action is performed
      redoStack.current = [];
      
      // Force sync timeline visuals with edit data
      await syncTimelineVisuals();
      
      // Update duration state
      setDuration(editRef.current.totalDuration);
      
      console.log('Clip deleted successfully');
    } catch (error) {
      console.error('Error deleting clip:', error);
    }
  };

  // Helper function to sync timeline visuals with edit data
  const syncTimelineVisuals = async () => {
    if (!timelineRef.current || !editRef.current) return;
    
    const visualTracks = timelineRef.current.getVisualTracks();
    const editData = editRef.current.getEdit();
    
    if (!visualTracks || !editData || !editData.timeline || !editData.timeline.tracks) return;
    
    // For each visual track, check if clips match edit data
    visualTracks.forEach((visualTrack, trackIdx) => {
      if (!visualTrack.clips) return;
      
      const editTrack = editData.timeline.tracks[trackIdx];
      const editClipCount = editTrack ? editTrack.clips.length : 0;
      
      // Remove extra visual clips that don't exist in edit data
      while (visualTrack.clips.length > editClipCount) {
        const clipToRemove = visualTrack.clips.pop();
        if (clipToRemove && clipToRemove.container && clipToRemove.container.parent) {
          clipToRemove.container.parent.removeChild(clipToRemove.container);
        }
      }
    });
    
    timelineRef.current.draw();
  };

  // Keyboard shortcut for delete
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle Delete key, and prevent if no clip is selected
      if (e.key === 'Delete') {
        e.preventDefault();
        handleDeleteClip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handlePlayPause = () => {
    if (editRef.current) {
      if (isPlaying) {
        editRef.current.pause();
      } else {
        editRef.current.play();
      }
    }
  };

  const handleStop = () => {
    if (editRef.current) {
      editRef.current.stop();
    }
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const newFiles = files.map(file => ({
      id: Date.now() + Math.random(),
      name: file.name,
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image',
      file: file
    }));
    setMediaFiles([...mediaFiles, ...newFiles]);
  };

  // Helper function to compress image
  const compressImage = (base64Data, maxWidth = 1280, quality = 0.7) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if larger than maxWidth
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to compressed JPEG
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = base64Data;
    });
  };

  // Helper function to convert base64 to blob
  const base64ToBlob = (base64Data) => {
    const byteString = atob(base64Data.split(',')[1]);
    const mimeType = base64Data.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType });
  };

  // Helper function to upload file to Shotstack Ingest API
  const uploadToShotstack = async (base64Data, apiKey) => {
    const mimeType = base64Data.split(',')[0].split(':')[1].split(';')[0];
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');
    
    let dataToUpload = base64Data;
    
    // Compress images before upload
    if (isImage && !mimeType.includes('gif')) {
      console.log('Compressing image...');
      dataToUpload = await compressImage(base64Data, 1280, 0.7);
    }
    
    // Check file size (limit to 25MB for Shotstack)
    const blob = base64ToBlob(dataToUpload);
    const sizeMB = blob.size / (1024 * 1024);
    console.log(`File size: ${sizeMB.toFixed(2)} MB`);
    
    if (sizeMB > 25) {
      throw new Error(`File too large (${sizeMB.toFixed(1)}MB). Maximum is 25MB. Please use a smaller file.`);
    }
    
    // Get file extension from mime type
    const finalMimeType = dataToUpload.split(',')[0].split(':')[1].split(';')[0];
    const extMap = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif'
    };
    const ext = extMap[finalMimeType] || 'mp4';
    const filename = `upload_${Date.now()}.${ext}`;
    
    // Create form data
    const formData = new FormData();
    formData.append('file', blob, filename);
    
    console.log(`Uploading ${filename} (${sizeMB.toFixed(2)} MB)...`);
    
    // Upload to Shotstack Ingest API
    const response = await fetch('https://api.shotstack.io/ingest/stage/sources', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error('Upload failed: ' + (error.message || 'Unknown error'));
    }
    
    const data = await response.json();
    return data.data.attributes.source;
  };

  const handleExport = async () => {
    if (editRef.current) {
      try {
        console.log('Rendering video...');
        
        // Shotstack API key from environment variable
        const apiKey = import.meta.env.VITE_SHOTSTACK_API_KEY;
        
        if (!apiKey) {
          alert('Shotstack API key not found. Please add VITE_SHOTSTACK_API_KEY to your .env file.');
          return;
        }
        
        // Get the edit data as JSON
        const editData = JSON.parse(JSON.stringify(editRef.current.getEdit()));
        console.log('Edit data:', editData);
        
        // Check for base64 data URLs and upload them to Shotstack
        let hasLocalFiles = false;
        const uploadPromises = [];
        
        if (editData.timeline && editData.timeline.tracks) {
          editData.timeline.tracks.forEach((track, trackIdx) => {
            if (track.clips) {
              track.clips.forEach((clip, clipIdx) => {
                if (clip.asset && clip.asset.src && clip.asset.src.startsWith('data:')) {
                  hasLocalFiles = true;
                  // Store promise with indices for later update
                  uploadPromises.push({
                    trackIdx,
                    clipIdx,
                    promise: uploadToShotstack(clip.asset.src, apiKey)
                  });
                }
              });
            }
          });
        }
        
        if (hasLocalFiles) {
          alert('Uploading local files to Shotstack servers...\nThis may take a moment.');
          
          // Upload all files
          try {
            const results = await Promise.all(uploadPromises.map(async (item) => {
              const url = await item.promise;
              return { ...item, url };
            }));
            
            // Update edit data with uploaded URLs
            results.forEach(({ trackIdx, clipIdx, url }) => {
              editData.timeline.tracks[trackIdx].clips[clipIdx].asset.src = url;
            });
            
            console.log('All files uploaded successfully');
          } catch (uploadError) {
            console.error('Upload error:', uploadError);
            alert('Failed to upload files: ' + uploadError.message + '\n\nTry with smaller files or use online URLs.');
            return;
          }
        }
        
        // Prepare the render request
        const renderRequest = {
          timeline: editData.timeline,
          output: editData.output || {
            format: 'mp4',
            resolution: 'sd'
          }
        };
        
        alert('Starting video render... This may take a few minutes.');
        
        // Submit render job to Shotstack API
        const renderResponse = await fetch('https://api.shotstack.io/stage/render', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          },
          body: JSON.stringify(renderRequest)
        });
        
        if (!renderResponse.ok) {
          const errorData = await renderResponse.json();
          throw new Error(errorData.message || 'Failed to submit render job');
        }
        
        const renderData = await renderResponse.json();
        const renderId = renderData.response.id;
        console.log('Render job submitted:', renderId);
        
        // Poll for render status
        alert('Render job submitted! Checking status...');
        
        let status = 'queued';
        let videoUrl = null;
        
        while (status === 'queued' || status === 'fetching' || status === 'rendering') {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
          
          const statusResponse = await fetch(`https://api.shotstack.io/stage/render/${renderId}`, {
            headers: {
              'x-api-key': apiKey
            }
          });
          
          if (!statusResponse.ok) {
            throw new Error('Failed to check render status');
          }
          
          const statusData = await statusResponse.json();
          status = statusData.response.status;
          console.log('Render status:', status);
          
          if (status === 'done') {
            videoUrl = statusData.response.url;
          } else if (status === 'failed') {
            throw new Error('Render failed: ' + (statusData.response.error || 'Unknown error'));
          }
        }
        
        if (videoUrl) {
          console.log('Video ready:', videoUrl);
          
          // Open video in new tab
          window.open(videoUrl, '_blank');
          
          alert('Video rendered successfully!\n\nThe video has been opened in a new tab.\n\nURL: ' + videoUrl);
        }
        
      } catch (error) {
        console.error('Export error:', error);
        alert('Export error: ' + error.message);
      }
    }
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleClipDoubleClick = (file) => {
    setPreviewFile(file);
    // Auto-play the preview after a short delay
    setTimeout(() => {
      if (previewVideoRef.current) {
        previewVideoRef.current.play().catch(err => console.log('Autoplay prevented:', err));
      }
    }, 100);
  };

  // Drag and Drop handlers
  const handleDragStart = (e, file) => {
    // Only pass the file ID - File objects can't be serialized to JSON
    e.dataTransfer.setData('text/plain', file.id.toString());
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    try {
      const fileId = e.dataTransfer.getData('text/plain');
      
      // Find the file in mediaFiles state
      const fileData = mediaFiles.find(f => f.id.toString() === fileId);
      
      if (!fileData) {
        console.error('File not found in media library');
        return;
      }
      
      if (!editRef.current) {
        console.error('Edit not initialized');
        return;
      }

      // Show loading state
      console.log(`Loading ${fileData.type}: ${fileData.name}...`);

      // Convert file to base64 data URL (Shotstack doesn't accept blob URLs)
      const base64Url = await convertFileToBase64(fileData.file);

      // Determine asset type and create clip configuration
      let assetConfig;
      
      if (fileData.type === 'video') {
        assetConfig = {
          type: 'video',
          src: base64Url
        };
      } else if (fileData.type === 'audio') {
        assetConfig = {
          type: 'audio',
          src: base64Url
        };
      } else if (fileData.type === 'image') {
        assetConfig = {
          type: 'image',
          src: base64Url
        };
      }

      // Calculate start time based on current timeline duration
      const currentDuration = editRef.current.totalDuration / 1000; // Convert ms to seconds
      
      // Create the clip object
      const clip = {
        asset: assetConfig,
        start: currentDuration, // Add at the end of current timeline
        length: fileData.type === 'image' ? 5 : 10, // Default duration: 5s for images, 10s for video/audio
      };

      // Add clip to first track (index 0)
      await editRef.current.addClip(0, clip);
      
      // Wait a moment for the clip to be fully added to internal data
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Force timeline to handle the edit change and rebuild
      if (timelineRef.current) {
        // handleEditChange is the proper method to notify timeline of changes
        await timelineRef.current.handleEditChange();
        // Then rebuild and draw
        await timelineRef.current.rebuildFromEdit();
        timelineRef.current.draw();
        // Update ruler duration for the new clip
        timelineRef.current.updateRulerDuration();
      }
      
      // Update the edit visuals
      editRef.current.update();
      editRef.current.draw();
      
      // Update duration state
      setDuration(editRef.current.totalDuration);
      
      console.log(`Added ${fileData.type} clip to timeline:`, fileData.name);
    } catch (error) {
      console.error('Error dropping media to timeline:', error);
      alert('Error adding media to timeline: ' + error.message);
    }
  };

  // Helper function to convert File to base64 data URL
  const convertFileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="app">
      {/* Top Menu Bar */}
      <div className="top-bar">
        <div className="logo">Creative Studio Pro</div>
        <div className="top-menu">
          <label className="file-upload-label">
            <input type="file" multiple accept="video/*,audio/*,image/*" onChange={handleFileUpload} style={{display: 'none'}} />
            <span>📁 Import</span>
          </label>
          <span onClick={handleExport}>💾 Export</span>
          <span onClick={handleUndo}>↶ Undo</span>
          <span onClick={handleRedo}>↷ Redo</span>
          <span onClick={handleDeleteClip} className={selectedClip ? '' : 'disabled'}>🗑️ Delete</span>
        </div>
      </div>

      {/* Top Section - Dual Monitors */}
      <div className="monitors-section">
        {/* Source Monitor */}
        <div className="monitor-panel">
          <div className="panel-header">SOURCE MONITOR</div>
          <div className="monitor-wrapper">
            {previewFile ? (
              <div className="source-preview">
                {previewFile.type === 'video' && (
                  <video 
                    ref={previewVideoRef}
                    src={previewFile.url} 
                    controls 
                    className="preview-video"
                  />
                )}
                {previewFile.type === 'audio' && (
                  <div className="audio-preview">
                    <div className="audio-icon">🎵</div>
                    <div className="audio-name">{previewFile.name}</div>
                    <audio 
                      ref={previewVideoRef}
                      src={previewFile.url} 
                      controls 
                      className="preview-audio"
                    />
                  </div>
                )}
                {previewFile.type === 'image' && (
                  <img 
                    src={previewFile.url} 
                    alt={previewFile.name} 
                    className="preview-image"
                  />
                )}
              </div>
            ) : (
              <div className="source-placeholder">
                <div className="placeholder-content">
                  <div className="placeholder-icon">🎬</div>
                  <p>Double-click a clip to preview</p>
                </div>
              </div>
            )}
          </div>
          <div className="monitor-controls">
            {previewFile && <div className="preview-name">{previewFile.name}</div>}
          </div>
        </div>

        {/* Program Monitor */}
        <div className="monitor-panel">
          <div className="panel-header">PROGRAM MONITOR</div>
          <div className="monitor-wrapper">
            <div data-shotstack-studio></div>
          </div>
          <div className="monitor-controls">
            <button onClick={handleStop} title="Stop">⏹</button>
            <button onClick={handlePlayPause} className={isPlaying ? 'playing' : ''} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <div className="time-display">{formatTime(currentTime)} / {formatTime(duration)}</div>
          </div>
        </div>
      </div>

      {/* Bottom Section - Project and Timeline */}
      <div className="bottom-section">
        {/* Left - Project Panel */}
        <div className="project-panel">
          <div className="panel-header">
            <span>PROJECT: Get Started</span>
            <div className="panel-icons">
              <button title="List View">☰</button>
              <button title="Icon View">⊞</button>
            </div>
          </div>
          <div className="project-content">
            {mediaFiles.length === 0 ? (
              <div className="empty-project">
                <div className="empty-icon">📁</div>
                <p>Import media files to get started</p>
                <label className="import-button">
                  <input type="file" multiple accept="video/*,audio/*,image/*" onChange={handleFileUpload} style={{display: 'none'}} />
                  Import Files
                </label>
              </div>
            ) : (
              <div className="media-grid">
                {mediaFiles.map(file => (
                  <div 
                    key={file.id} 
                    className="media-item" 
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, file)}
                    onDoubleClick={() => handleClipDoubleClick(file)}
                  >
                    <div className="media-thumbnail">
                      {file.type === 'video' ? '🎬' : file.type === 'audio' ? '🎵' : '🖼️'}
                    </div>
                    <div className="media-label" title={file.name}>{file.name}</div>
                    <div className="media-duration">{file.type}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right - Timeline Panel */}
        <div 
          className={`timeline-section ${isDraggingOver ? 'drag-over' : ''}`}
        >
          <div className="panel-header">
            <span>TIMELINE - Sequence 01</span>
            {selectedClip && (
              <span className="clip-info">Track {selectedClip.trackIndex} | {selectedClip.clip?.asset?.type}</span>
            )}
          </div>
          <div 
            className={`timeline-content ${isDraggingOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div data-shotstack-timeline></div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <span>Ready</span>
        <span className="shortcuts-hint">Space: Play/Pause | J: Stop | K: Pause | L: Play | Arrow Keys: Seek</span>
      </div>
    </div>
  );
}

export default App;
