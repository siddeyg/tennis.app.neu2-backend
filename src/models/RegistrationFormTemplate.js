/**
 * RegistrationFormTemplate Model
 *
 * Stores predefined field configurations for registration forms.
 * Used by RegistrationPeriod to configure which fields are enabled/required.
 *
 * OPTIONAL MODEL - Can be skipped for MVP
 * Current implementation uses direct field arrays in RegistrationPeriod
 */

import mongoose from 'mongoose';

const fieldDefinitionSchema = new mongoose.Schema({
  fieldName: {
    type: String,
    required: true,
    trim: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  fieldType: {
    type: String,
    required: true,
    enum: [
      'text',           // Single-line text input
      'email',          // Email input with validation
      'phone',          // Phone number input
      'date',           // Date picker
      'textarea',       // Multi-line text
      'select',         // Dropdown (single select)
      'multiselect',    // Multiple checkboxes
      'checkbox',       // Single checkbox (yes/no)
      'radio',          // Radio buttons
      'availableTimes', // Custom component for time selection
      'sepa'            // Custom component for IBAN + account holder
    ]
  },
  options: [String],  // For select/multiselect/radio: list of choices
  validation: {
    required: { type: Boolean, default: false },
    minLength: Number,
    maxLength: Number,
    pattern: String,  // Regex pattern for validation
    customValidator: String // Name of custom validation function
  },
  defaultValue: mongoose.Schema.Types.Mixed,
  helpText: String,   // Description shown to user
  placeholder: String,
  order: {
    type: Number,
    default: 0
  },
  isEnabled: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const registrationFormTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },

  description: {
    type: String,
    trim: true
  },

  formType: {
    type: String,
    required: true,
    enum: ['kids', 'adults'],
    index: true
  },

  fields: [fieldDefinitionSchema],

  // Admin who created this template
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Track usage
  usageCount: {
    type: Number,
    default: 0
  },

  // Allow soft delete
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
registrationFormTemplateSchema.index({ formType: 1, isActive: 1 });
registrationFormTemplateSchema.index({ createdBy: 1 });

// Virtual: Get enabled fields count
registrationFormTemplateSchema.virtual('enabledFieldsCount').get(function () {
  return this.fields.filter(f => f.isEnabled).length;
});

// Virtual: Get required fields count
registrationFormTemplateSchema.virtual('requiredFieldsCount').get(function () {
  return this.fields.filter(f => f.isEnabled && f.validation?.required).length;
});

// Method: Get field by name
registrationFormTemplateSchema.methods.getField = function (fieldName) {
  return this.fields.find(f => f.fieldName === fieldName);
};

// Method: Get enabled fields sorted by order
registrationFormTemplateSchema.methods.getEnabledFields = function () {
  return this.fields
    .filter(f => f.isEnabled)
    .sort((a, b) => a.order - b.order);
};

// Method: Validate form data against template
registrationFormTemplateSchema.methods.validateFormData = function (formData) {
  const errors = [];

  this.fields.forEach(field => {
    if (!field.isEnabled) return; // Skip disabled fields

    const value = formData[field.fieldName];

    // Required validation
    if (field.validation?.required && (!value || value.length === 0)) {
      errors.push({
        field: field.fieldName,
        message: `${field.label} ist erforderlich`
      });
    }

    // Min/max length validation
    if (value && typeof value === 'string') {
      if (field.validation?.minLength && value.length < field.validation.minLength) {
        errors.push({
          field: field.fieldName,
          message: `${field.label} muss mindestens ${field.validation.minLength} Zeichen lang sein`
        });
      }
      if (field.validation?.maxLength && value.length > field.validation.maxLength) {
        errors.push({
          field: field.fieldName,
          message: `${field.label} darf maximal ${field.validation.maxLength} Zeichen lang sein`
        });
      }
    }

    // Pattern validation
    if (value && field.validation?.pattern) {
      const regex = new RegExp(field.validation.pattern);
      if (!regex.test(value)) {
        errors.push({
          field: field.fieldName,
          message: `${field.label} hat ein ungültiges Format`
        });
      }
    }

    // Options validation (for select/multiselect)
    if (value && field.options && field.options.length > 0) {
      if (Array.isArray(value)) {
        // Multi-select: all values must be in options
        const invalidValues = value.filter(v => !field.options.includes(v));
        if (invalidValues.length > 0) {
          errors.push({
            field: field.fieldName,
            message: `${field.label} enthält ungültige Werte`
          });
        }
      } else {
        // Single select: value must be in options
        if (!field.options.includes(value)) {
          errors.push({
            field: field.fieldName,
            message: `${field.label} hat einen ungültigen Wert`
          });
        }
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
};

// Static: Create kids template with default fields
registrationFormTemplateSchema.statics.createKidsDefault = async function (userId) {
  return await this.create({
    name: 'Standard Jugendformular',
    description: 'Standardfelder für Jugendtraining-Anmeldungen',
    formType: 'kids',
    createdBy: userId,
    fields: [
      {
        fieldName: 'mitgliedsstatus',
        label: 'Mitgliedsstatus',
        fieldType: 'select',
        options: ['Mitglied', 'Nicht-Mitglied/Schnupperkind'],
        validation: { required: true },
        helpText: 'Bitte Mitgliedsstatus angeben',
        order: 1
      },
      {
        fieldName: 'trainingsart',
        label: 'Trainingsart',
        fieldType: 'select',
        options: [
          'Kindergarten (ca. 4-6 Jahre)',
          'KIDS-ROT (ca. 6-8 Jahre)',
          'KIDS-ORANGE (ca. 8-10 Jahre)',
          'KIDS-GRÜN (ca. 10-12 Jahre)',
          'Jugend HOBBY (Gelb)',
          'Jugend TEAM (Gelb)'
        ],
        validation: { required: true },
        helpText: 'Welche Altersgruppe/Level?',
        order: 2
      },
      {
        fieldName: 'trainingshäufigkeit',
        label: 'Trainingshäufigkeit',
        fieldType: 'select',
        options: ['1x pro Woche', '2x pro Woche'],
        validation: { required: true },
        helpText: 'Wie oft möchte Ihr Kind trainieren?',
        order: 3
      },
      {
        fieldName: 'teamParticipation',
        label: 'Mannschaftsspiel',
        fieldType: 'checkbox',
        helpText: 'Möchte Ihr Kind in einer Mannschaft spielen?',
        order: 4
      },
      {
        fieldName: 'availableTimesKids',
        label: 'Verfügbare Zeiten',
        fieldType: 'availableTimes',
        validation: { required: true },
        helpText: 'Bitte mindestens 5 Zeiten auswählen',
        order: 5
      },
      {
        fieldName: 'sepaMandate',
        label: 'SEPA-Lastschriftmandat',
        fieldType: 'sepa',
        validation: { required: false },
        helpText: 'Optional: SEPA-Lastschriftmandat erteilen',
        order: 6
      },
      {
        fieldName: 'remarks',
        label: 'Anmerkungen',
        fieldType: 'textarea',
        validation: { maxLength: 2000 },
        placeholder: 'Weitere Anmerkungen oder Wünsche...',
        order: 7
      }
    ]
  });
};

// Static: Create adults template with default fields
registrationFormTemplateSchema.statics.createAdultsDefault = async function (userId) {
  return await this.create({
    name: 'Standard Erwachsenenformular',
    description: 'Standardfelder für Erwachsenentraining-Anmeldungen',
    formType: 'adults',
    createdBy: userId,
    fields: [
      {
        fieldName: 'spielstärke',
        label: 'Spielstärke',
        fieldType: 'select',
        options: [
          'Anfänger',
          'Anfänger mit Grundkenntnissen',
          'Fortgeschrittene',
          'Erfahrene Spieler:innen / Mannschaftsspieler:innen',
          'Leistungsspieler:innen / Turnierspieler:innen'
        ],
        validation: { required: true },
        helpText: 'Bitte Ihr aktuelles Spielniveau angeben',
        order: 1
      },
      {
        fieldName: 'trainingGoals',
        label: 'Trainingsziele',
        fieldType: 'multiselect',
        options: ['Freizeit', 'Fitness', 'Turniere', 'Mannschaft'],
        validation: { required: true },
        helpText: 'Mehrfachauswahl möglich',
        order: 2
      },
      {
        fieldName: 'groupSize',
        label: 'Gruppengröße',
        fieldType: 'multiselect',
        options: [
          'Einzeltraining',
          'zu zweit',
          'zu dritt',
          'zu viert',
          'Mannschaftstraining'
        ],
        validation: { required: true },
        helpText: 'Bevorzugte Gruppengröße (Mehrfachauswahl möglich)',
        order: 3
      },
      {
        fieldName: 'availableTimesAdults',
        label: 'Verfügbare Zeiten',
        fieldType: 'availableTimes',
        validation: { required: true },
        helpText: 'Bitte mindestens 5 Zeiten auswählen',
        order: 4
      },
      {
        fieldName: 'sepaMandate',
        label: 'SEPA-Lastschriftmandat',
        fieldType: 'sepa',
        validation: { required: false },
        helpText: 'Optional: SEPA-Lastschriftmandat erteilen',
        order: 5
      },
      {
        fieldName: 'remarks',
        label: 'Anmerkungen',
        fieldType: 'textarea',
        validation: { maxLength: 2000 },
        placeholder: 'Weitere Anmerkungen oder Wünsche...',
        order: 6
      }
    ]
  });
};

const RegistrationFormTemplate = mongoose.model('RegistrationFormTemplate', registrationFormTemplateSchema);

export default RegistrationFormTemplate;
