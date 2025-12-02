import type { RecordingMetadata, CursorKeyframe, ZoomKeyframe, ClickEvent } from '../../types/metadata';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Timeline');

export class Timeline {
  private container: HTMLElement;
  private ruler: HTMLElement;
  private track: HTMLElement;
  private playhead: HTMLElement;
  private metadata: RecordingMetadata | null = null;
  private duration: number = 0;
  private pixelsPerSecond: number = 100;
  private onSeek: ((time: number) => void) | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Timeline container not found: ${containerId}`);
    }
    this.container = container;

    // Find sub-elements
    this.ruler = container.querySelector('.timeline-ruler') as HTMLElement;
    this.track = container.querySelector('.timeline-track') as HTMLElement;
    this.playhead = container.querySelector('.playhead') as HTMLElement;

    if (!this.ruler || !this.track || !this.playhead) {
      throw new Error('Timeline sub-elements not found');
    }

    this.setupEventListeners();
  }

  setMetadata(metadata: RecordingMetadata, duration: number) {
    this.metadata = metadata;
    this.duration = duration;
    this.updateTimelineWidth();
    this.render();
  }

  /**
   * Calculate and set the timeline width based on duration
   */
  private updateTimelineWidth() {
    if (!this.duration || this.duration <= 0) return;
    
    // Calculate timeline width: duration in seconds * pixels per second
    const durationSeconds = this.duration / 1000;
    const timelineWidth = durationSeconds * this.pixelsPerSecond;
    
    // Set width on ruler and track to make timeline scrollable
    // Remove 'right: 0' CSS that would override the width
    this.ruler.style.width = `${timelineWidth}px`;
    this.ruler.style.right = 'auto';
    this.track.style.width = `${timelineWidth}px`;
    this.track.style.right = 'auto';
    
    logger.debug('Timeline width updated:', {
      duration: this.duration.toFixed(2),
      durationSeconds: durationSeconds.toFixed(2),
      pixelsPerSecond: this.pixelsPerSecond,
      timelineWidth: timelineWidth.toFixed(2),
      rulerWidth: this.ruler.offsetWidth.toFixed(2),
      trackWidth: this.track.offsetWidth.toFixed(2),
    });
  }

  /**
   * Get the actual timeline width (based on duration, not container width)
   */
  private getTimelineWidth(): number {
    if (!this.duration || this.duration <= 0) {
      return this.container.offsetWidth || 0;
    }
    const durationSeconds = this.duration / 1000;
    return durationSeconds * this.pixelsPerSecond;
  }

  setOnSeek(callback: (time: number) => void) {
    this.onSeek = callback;
  }

  updatePlayhead(time: number) {
    if (!this.duration) return;
    // time is in seconds, duration is in milliseconds
    const timeMs = time * 1000;
    const timelineWidth = this.getTimelineWidth();
    const position = (timeMs / this.duration) * timelineWidth;
    this.playhead.style.left = `${position}px`;
    
    // Debug logging
    logger.debug('Timeline playhead update:', {
      time: time.toFixed(3),
      timeMs: timeMs.toFixed(2),
      duration: this.duration.toFixed(2),
      timelineWidth: timelineWidth.toFixed(2),
      position: position.toFixed(2),
    });
  }

  private setupEventListeners() {
    let isDragging = false;

    this.container.addEventListener('mousedown', (e) => {
      isDragging = true;
      this.handleSeek(e);
    });

    this.container.addEventListener('mousemove', (e) => {
      if (isDragging) {
        this.handleSeek(e);
      }
    });

    this.container.addEventListener('mouseup', () => {
      isDragging = false;
    });

    this.container.addEventListener('mouseleave', () => {
      isDragging = false;
    });

    this.container.addEventListener('click', (e) => {
      this.handleSeek(e);
    });
  }

  private handleSeek(e: MouseEvent) {
    if (!this.duration || this.duration <= 0) return;
    
    const rect = this.container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scrollLeft = this.container.scrollLeft;
    // Calculate mouse position relative to the timeline content, accounting for scroll position
    const x = mouseX + scrollLeft;
    
    const timelineWidth = this.getTimelineWidth();
    
    // Calculate time based on position in the full timeline
    const timeMs = (x / timelineWidth) * this.duration;
    const timeSeconds = timeMs / 1000; // Convert to seconds
    const clampedTime = Math.max(0, Math.min(timeSeconds, this.duration / 1000));
    
    // Debug logging
    logger.debug('Timeline seek calculation:', {
      mouseX: mouseX.toFixed(2),
      scrollLeft: scrollLeft.toFixed(2),
      absoluteX: x.toFixed(2),
      timelineWidth: timelineWidth.toFixed(2),
      duration: this.duration.toFixed(2),
      timeMs: timeMs.toFixed(2),
      timeSeconds: timeSeconds.toFixed(3),
      clampedTime: clampedTime.toFixed(3),
    });
    
    if (this.onSeek) {
      this.onSeek(clampedTime);
    }
  }

  private render() {
    if (!this.metadata || !this.duration) return;

    // Ensure timeline width is set
    this.updateTimelineWidth();
    
    // Wait for container to have width before rendering
    if (this.container.offsetWidth === 0) {
      // Defer rendering until container has dimensions
      setTimeout(() => this.render(), 100);
      return;
    }
    
    const timelineWidth = this.getTimelineWidth();
    if (timelineWidth === 0) {
      // Defer rendering until timeline has width
      setTimeout(() => this.render(), 100);
      return;
    }

    // Clear existing markers
    const existingMarkers = this.track.querySelectorAll('.keyframe-marker');
    existingMarkers.forEach(marker => marker.remove());

    // Render cursor keyframes
    this.metadata.cursor.keyframes.forEach(keyframe => {
      this.createKeyframeMarker(keyframe.timestamp, 'cursor', keyframe);
    });

    // Render zoom keyframes
    this.metadata.zoom.keyframes.forEach(keyframe => {
      this.createKeyframeMarker(keyframe.timestamp, 'zoom', keyframe);
    });

    // Render click events
    this.metadata.clicks.forEach(click => {
      this.createKeyframeMarker(click.timestamp, 'click', click);
    });

    // Render ruler
    this.renderRuler();
  }

  private createKeyframeMarker(timestamp: number, type: 'cursor' | 'zoom' | 'click', data: any) {
    if (!this.duration || this.duration === 0) return;
    
    const timelineWidth = this.getTimelineWidth();
    if (timelineWidth === 0) return; // Can't position if timeline has no width
    
    // Clamp timestamp to actual video duration (keyframes beyond video end won't be shown)
    const clampedTimestamp = Math.max(0, Math.min(timestamp, this.duration));
    const position = (clampedTimestamp / this.duration) * timelineWidth;
    
    const marker = document.createElement('div');
    marker.className = `keyframe-marker ${type}`;
    marker.style.left = `${position}px`;
    marker.title = `${type} at ${this.formatTime(clampedTimestamp / 1000)}`;
    marker.dataset.timestamp = clampedTimestamp.toString();
    marker.dataset.type = type;
    
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const time = clampedTimestamp / 1000; // Use clamped timestamp for seeking
      if (this.onSeek) {
        this.onSeek(time);
      }
    });

    this.track.appendChild(marker);
  }

  private renderRuler() {
    if (!this.ruler || !this.duration) return;

    // Clear existing ruler marks
    const existingMarks = this.ruler.querySelectorAll('.ruler-mark');
    existingMarks.forEach(mark => mark.remove());

    const timelineWidth = this.getTimelineWidth();
    const interval = this.calculateRulerInterval();
    const marks: number[] = [];

    for (let time = 0; time <= this.duration; time += interval) {
      marks.push(time);
    }

    logger.debug('Rendering ruler:', {
      duration: this.duration.toFixed(2),
      durationSeconds: (this.duration / 1000).toFixed(2),
      timelineWidth: timelineWidth.toFixed(2),
      interval: interval.toFixed(2),
      intervalSeconds: (interval / 1000).toFixed(2),
      numMarks: marks.length,
      rulerWidth: this.ruler.offsetWidth.toFixed(2),
      rulerStyleWidth: this.ruler.style.width,
    });

    marks.forEach(time => {
      const position = (time / this.duration) * timelineWidth;
      const timeSeconds = time / 1000;
      
      logger.debug(`Ruler mark at ${this.formatTime(timeSeconds)}:`, {
        time: time.toFixed(2),
        timeSeconds: timeSeconds.toFixed(3),
        position: position.toFixed(2),
        timelineWidth: timelineWidth.toFixed(2),
        ratio: (time / this.duration).toFixed(4),
      });
      
      const mark = document.createElement('div');
      mark.className = 'ruler-mark';
      mark.style.position = 'absolute';
      mark.style.left = `${position}px`;
      mark.style.top = '0';
      mark.style.width = '1px';
      mark.style.height = '30px';
      mark.style.background = '#666';
      
      const label = document.createElement('div');
      label.textContent = this.formatTime(timeSeconds);
      label.style.position = 'absolute';
      label.style.left = `${position + 2}px`;
      label.style.top = '2px';
      label.style.fontSize = '10px';
      label.style.color = '#999';
      mark.appendChild(label);

      this.ruler.appendChild(mark);
    });
  }

  private calculateRulerInterval(): number {
    // Calculate appropriate interval based on duration
    // Return interval in milliseconds
    if (this.duration < 10000) return 1000; // 1 second
    if (this.duration < 60000) return 5000; // 5 seconds
    if (this.duration < 300000) return 10000; // 10 seconds
    return 30000; // 30 seconds
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

