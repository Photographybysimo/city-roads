<template>
<div class='venue-find'>
  <h3 class='site-header'>venue maps</h3>
  <p class='description'>Every road around your venue, colored by distance. Ready to print.</p>

  <form class='venue-form shadow' @submit.prevent='submit'>
    <label class='field wide'>
      <span>Venue</span>
      <input v-model='place' type='text' ref='input'
        placeholder='Ritz-Carlton Sarasota  —  or  27.3364, -82.5307' :disabled='busy'>
    </label>
    <label class='field'>
      <span>Event (optional)</span>
      <input v-model='event' type='text' placeholder='Leadership Summit 2026' :disabled='busy'>
    </label>
    <div class='field'>
      <span>Radius</span>
      <div class='chips'>
        <button v-for='r in radii' :key='r' type='button' :class='{active: radiusKm === r}'
          @click='radiusKm = r' :disabled='busy'>{{r}} km</button>
      </div>
    </div>
    <button class='go' type='submit' :disabled='busy || !place.trim()'>
      {{busy ? 'Working…' : 'Create venue map'}}
    </button>
  </form>

  <div v-if='status' class='status message shadow' :class='{error: isError}'>
    <loading-icon v-if='busy'></loading-icon>
    <span>{{status}}</span>
    <a v-if='busy' href='#' class='cancel' @click.prevent='$emit("cancel")'>cancel</a>
  </div>

  <p class='hint'>
    Tip: 2 km loads in seconds. 5 km can take a minute on busy servers.
    <br>
    <a href='#' @click.prevent='$emit("city-mode")'>Render a whole city instead →</a>
  </p>
</div>
</template>

<script>
import LoadingIcon from './LoadingIcon.vue';

export default {
  name: 'VenueFind',
  components: {LoadingIcon},
  props: {
    busy: Boolean,
    status: String,
    isError: Boolean,
  },
  emits: ['submit', 'cancel', 'city-mode'],
  data() {
    return {
      place: '',
      event: '',
      radiusKm: 2,
      radii: [1, 2, 3, 5],
    };
  },
  mounted() {
    this.$refs.input.focus();
  },
  methods: {
    submit() {
      const query = this.place.trim();
      if (!query) return;
      const options = {radiusKm: this.radiusKm, event: this.event.trim()};
      // Accept pasted coordinates, e.g. from Google Maps: "27.3364, -82.5307"
      const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (coords) {
        options.lat = +coords[1];
        options.lon = +coords[2];
        options.title = '';
      } else {
        options.place = query;
      }
      this.$emit('submit', options);
    },
  },
};
</script>

<style lang='stylus'>
@import('../vars.styl');

.venue-find {
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 520px;
  max-width: calc(100vw - 32px);
  text-align: center;

  .site-header {
    font-size: 28px;
    font-weight: normal;
    margin: 0;
  }
  .description {
    margin: 8px 0 20px;
    color: secondary-color;
  }
  .venue-form {
    background: white;
    padding: 16px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    span {
      font-size: 12px;
      color: secondary-color;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    input {
      font-size: 16px;
      padding: 8px 10px;
      border: 1px solid border-color;
      outline: none;
      font-family: inherit;
      &:focus {
        border-color: highlight-color;
      }
    }
  }
  .chips {
    display: flex;
    gap: 8px;
  }
  .chips button, .go {
    font-family: inherit;
    font-size: 14px;
    padding: 8px 14px;
    border: 1px solid border-color;
    background: white;
    cursor: pointer;
    color: primary-text;
  }
  .chips button.active {
    border-color: highlight-color;
    color: highlight-color;
  }
  .go {
    background: highlight-color;
    border-color: highlight-color;
    color: white;
    font-size: 16px;
    padding: 10px;
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    text-align: left;
    font-size: 14px;
    span {
      flex: 1;
    }
    &.error {
      color: #b00020;
    }
  }
  .hint {
    font-size: 13px;
    color: secondary-color;
    line-height: 1.6;
  }
}
</style>
